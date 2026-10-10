import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeEvidenceClaim, encodeSnapshotClaim } from "@eox/oracle-worker/protocol";
import {
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  bytesToHex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  hexToBytes,
  http,
  maxUint256,
  pad,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Relay, type RelayState, type Sender, emptyState } from "../src/relay.js";
import { readState, writeState } from "../src/state-file.js";

const OUT = fileURLToPath(new URL("../../../packages/optimistic-oracle/evm/out", import.meta.url));
const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;

function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(`${OUT}/${file}/${name}.json`, "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const asserter = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const relayer = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

const word = (value: number): Hex => pad(`0x${value.toString(16)}`, { size: 32 });
const bytes = (hex: Hex): number[] => [...hexToBytes(hex)];
const fill = (value: number): number[] => new Array<number>(32).fill(value);

const EPOCH = 7n;
const PROGRAM = word(0xa1);
const REGISTRY = word(0xa2);
const MANIFEST = word(0xb1);
const CONFIG = word(0xb2);
const POLICY = word(0xb3);
const FEE = 1_000n;

describe.skipIf(!hasAnvil || !existsSync(`${OUT}/EoxContinuousAdapter.sol`))("relay against the adapter on Anvil", () => {
  const port = 9545 + Math.floor(Math.random() * 1000);
  const transport = http(`http://127.0.0.1:${port}`);
  const client = createPublicClient({ chain: foundry, transport }) as PublicClient;
  const test = createTestClient({ chain: foundry, transport, mode: "anvil" });
  const ownerWallet = createWalletClient({ chain: foundry, transport, account: owner });
  const asserterWallet = createWalletClient({ chain: foundry, transport, account: asserter });
  const relayerWallet = createWalletClient({ chain: foundry, transport, account: relayer });
  const sender: Sender = { address: relayer.address, send: (transaction) => relayerWallet.sendTransaction(transaction) };
  const at: Record<"oracle" | "wormhole" | "token" | "adapter", Address> = {} as never;
  const abis: Record<"oracle" | "wormhole" | "token" | "adapter", Abi> = {} as never;
  let anvil: ChildProcess;
  let saved: RelayState = emptyState();
  let relay: Relay;

  async function deploy(file: string, name: string, args: unknown[] = []): Promise<Address> {
    const { abi, bytecode } = artifact(file, name);
    const hash = await ownerWallet.deployContract({ abi, bytecode, args });
    return (await client.waitForTransactionReceipt({ hash })).contractAddress!;
  }

  async function send(address: Address, abi: Abi, functionName: string, args: unknown[]) {
    const hash = await ownerWallet.writeContract({ address, abi, functionName, args });
    await client.waitForTransactionReceipt({ hash });
  }

  async function assert(functionName: "assertEvidence" | "assertSnapshot", args: unknown[]): Promise<Hex> {
    const { request, result } = await client.simulateContract({
      account: asserter,
      address: at.adapter,
      abi: abis.adapter,
      functionName,
      args,
    });
    await client.waitForTransactionReceipt({ hash: await asserterWallet.writeContract(request) });
    return result as Hex;
  }

  function context() {
    return {
      version: 1,
      evm_chain_id: String(foundry.id),
      adapter: bytes(at.adapter),
      solana_program: bytes(PROGRAM),
      registry: bytes(REGISTRY),
      epoch: EPOCH.toString(),
      methodology_manifest: bytes(MANIFEST),
      configuration_digest: bytes(CONFIG),
      evidence_policy: bytes(POLICY),
    };
  }

  async function register(proposal: Hex, precommitment: Hex, tag: number) {
    const records = [
      { record_id: `eox:observation:${tag}`, evidence_digest: fill(tag), assessment_digest: fill(tag + 1) },
      { record_id: `eox:observation:${tag + 2}`, evidence_digest: fill(tag + 2), assessment_digest: fill(tag + 3) },
    ];
    const ids: Hex[] = [];
    for (const record of records) {
      const claim = encodeEvidenceClaim({
        context: context(),
        ...record,
        metadata_digest: fill(tag + 4),
        artifact_digests: [fill(tag + 5)],
        provenance_digests: [fill(tag + 6)],
      });
      ids.push(await assert("assertEvidence", [proposal, precommitment, bytesToHex(claim)]));
    }
    const claim = encodeSnapshotClaim({
      context: context(),
      proposal: bytes(proposal),
      precommitment: bytes(precommitment),
      predecessor: null,
      cutoff: "1800000000",
      slots: [
        {
          country: 0,
          indicator: 0,
          current: { ...records[0]!, assertion_id: bytes(ids[0]!) },
          comparison: { ...records[1]!, assertion_id: bytes(ids[1]!) },
        },
      ],
      evidence_assertions: [...ids].sort().map(bytes),
    });
    const snapshot = await assert("assertSnapshot", [bytesToHex(claim)]);
    return { evidence: ids, snapshot };
  }

  const published = () => client.readContract({ address: at.wormhole, abi: abis.wormhole, functionName: "count" });
  const proposalOf = (proposal: Hex) =>
    client.readContract({ address: at.adapter, abi: abis.adapter, functionName: "proposal", args: [proposal] }) as Promise<{
      closed: boolean;
      accepted: boolean;
      eventCount: bigint;
    }>;
  const newRelay = (state: RelayState) =>
    new Relay({ client, adapter: at.adapter, sender, state, startBlock: 0n, save: async (s) => void (saved = structuredClone(s)) });
  const passAnHour = async () => {
    await test.increaseTime({ seconds: 3600 });
    await test.mine({ blocks: 1 });
  };

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
    for (let i = 0; i < 100; i++) {
      try {
        await client.getChainId();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    for (const [key, file, name] of [
      ["oracle", "MockOptimisticOracleV3.sol", "MockOptimisticOracleV3"],
      ["wormhole", "MockWormhole.sol", "MockWormhole"],
      ["token", "MockERC20.sol", "MockERC20"],
      ["adapter", "EoxContinuousAdapter.sol", "EoxContinuousAdapter"],
    ] as const) {
      abis[key] = artifact(file, name).abi;
    }
    at.oracle = await deploy("MockOptimisticOracleV3.sol", "MockOptimisticOracleV3", [parseUnits("500", 6)]);
    at.wormhole = await deploy("MockWormhole.sol", "MockWormhole");
    at.token = await deploy("MockERC20.sol", "MockERC20");
    at.adapter = await deploy("EoxContinuousAdapter.sol", "EoxContinuousAdapter", [
      at.oracle,
      at.wormhole,
      at.token,
      PROGRAM,
      REGISTRY,
      owner.address,
    ]);
    await send(at.adapter, abis.adapter, "openEpoch", [EPOCH, MANIFEST, CONFIG, POLICY]);
    await send(at.adapter, abis.adapter, "setAsserter", [asserter.address, true]);
    await send(at.token, abis.token, "mint", [asserter.address, parseUnits("100000", 6)]);
    await send(at.wormhole, abis.wormhole, "setFee", [FEE]);
    await client.waitForTransactionReceipt({
      hash: await asserterWallet.writeContract({ address: at.token, abi: abis.token, functionName: "approve", args: [at.adapter, maxUint256] }),
    });
    relay = newRelay(saved);
  }, 30_000);

  afterAll(() => {
    anvil?.kill();
  });

  it("publishes each registration once", async () => {
    await register(word(0xc1), word(0xc2), 10);
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 3 });
    expect(await published()).toBe(3n);
    expect(await client.getBalance({ address: at.wormhole })).toBe(3n * FEE);
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 0 });
    expect(await published()).toBe(3n);
  });

  it("settles after the hour, closes the proposal and publishes the outcome", async () => {
    await passAnHour();
    expect(await relay.tick()).toEqual({ settled: 3, closed: 1, published: 0 });
    expect(await proposalOf(word(0xc1))).toMatchObject({ closed: true, accepted: true, eventCount: 6n });
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 4 });
    expect(await published()).toBe(7n);

    const closure = (await client.readContract({ address: at.wormhole, abi: abis.wormhole, functionName: "payloadAt", args: [6n] })) as Hex;
    expect(hexToBytes(closure)[176]).toBe(3);
    expect(saved.inFlight).toEqual({});
  });

  it("resumes from saved state or from the chain without repeating anything", async () => {
    const directory = mkdtempSync(join(tmpdir(), "uma-relay-"));
    const path = join(directory, "state.json");
    expect(await readState(path)).toEqual(emptyState());
    await writeState(path, saved);

    expect(await newRelay(await readState(path)).tick()).toEqual({ settled: 0, closed: 0, published: 0 });
    const rebuilt = newRelay(emptyState());
    expect(await rebuilt.tick()).toEqual({ settled: 0, closed: 0, published: 0 });
    expect(rebuilt.state.proposals).toEqual(relay.state.proposals);
    expect(await published()).toBe(7n);
    relay = rebuilt;
  });

  it("waits for UMA to resolve a dispute and relays the rejection", async () => {
    const proposal = word(0xd1);
    const { evidence } = await register(proposal, word(0xd2), 40);
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 3 });

    await send(at.oracle, abis.oracle, "dispute", [evidence[0]]);
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 1 });

    await passAnHour();
    expect(await relay.tick()).toEqual({ settled: 2, closed: 0, published: 0 });
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 2 });
    expect((await proposalOf(proposal)).closed).toBe(false);

    await send(at.oracle, abis.oracle, "setVote", [evidence[0], false]);
    expect(await relay.tick()).toEqual({ settled: 1, closed: 1, published: 0 });
    expect(await proposalOf(proposal)).toMatchObject({ closed: true, accepted: false, eventCount: 7n });
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 2 });
    expect(await published()).toBe(15n);
  });
});
