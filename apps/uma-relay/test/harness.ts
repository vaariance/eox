import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  pad,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import type { Sender } from "../src/relay.js";

const OUT = fileURLToPath(new URL("../../../packages/optimistic-oracle/evm/out", import.meta.url));

export const canRun = spawnSync("anvil", ["--version"]).status === 0 && existsSync(`${OUT}/EoxContinuousAdapter.sol`);

export const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
export const asserter = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
export const relayer = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");

export const word = (value: number): Hex => pad(`0x${value.toString(16)}`, { size: 32 });
const bytes = (hex: Hex): number[] => [...hexToBytes(hex)];
const fill = (value: number): number[] => new Array<number>(32).fill(value);

export const EPOCH = 7n;
export const PROGRAM = word(0xa1);
export const REGISTRY = word(0xa2);
export const MANIFEST = word(0xb1);
export const CONFIG = word(0xb2);
export const POLICY = word(0xb3);
export const BOND = parseUnits("500", 6);
export const FEE = 1_000n;

export interface EvidenceRecord {
  record_id: string;
  evidence_digest: number[];
  assessment_digest: number[];
}

type Contract = "oracle" | "wormhole" | "token" | "adapter";

function artifact(file: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(`${OUT}/${file}.sol/${file}.json`, "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

export async function startChain(basePort: number) {
  const port = basePort + Math.floor(Math.random() * 1000);
  const transport = http(`http://127.0.0.1:${port}`);
  const client = createPublicClient({ chain: foundry, transport }) as PublicClient;
  const test = createTestClient({ chain: foundry, transport, mode: "anvil" });
  const wallets = {
    owner: createWalletClient({ chain: foundry, transport, account: owner }),
    asserter: createWalletClient({ chain: foundry, transport, account: asserter }),
    relayer: createWalletClient({ chain: foundry, transport, account: relayer }),
  };
  const anvil: ChildProcess = spawn("anvil", ["--port", String(port), "--silent"], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      await client.getChainId();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const abis: Record<Contract, Abi> = {
    oracle: artifact("MockOptimisticOracleV3").abi,
    wormhole: artifact("MockWormhole").abi,
    token: artifact("MockERC20").abi,
    adapter: artifact("EoxContinuousAdapter").abi,
  };
  const at = {} as Record<Contract, Address>;

  async function deploy(file: string, args: unknown[] = []): Promise<Address> {
    const { abi, bytecode } = artifact(file);
    const hash = await wallets.owner.deployContract({ abi, bytecode, args });
    return (await client.waitForTransactionReceipt({ hash })).contractAddress!;
  }

  async function send(contract: Contract, functionName: string, args: unknown[], from: keyof typeof wallets = "owner") {
    const hash = await wallets[from].writeContract({ address: at[contract], abi: abis[contract], functionName, args });
    await client.waitForTransactionReceipt({ hash });
  }

  const read = <T>(contract: Contract, functionName: string, args: unknown[] = []) =>
    client.readContract({ address: at[contract], abi: abis[contract], functionName, args }) as Promise<T>;

  at.oracle = await deploy("MockOptimisticOracleV3", [BOND]);
  at.wormhole = await deploy("MockWormhole");
  at.token = await deploy("MockERC20");
  at.adapter = await deploy("EoxContinuousAdapter", [at.oracle, at.wormhole, at.token, PROGRAM, REGISTRY, owner.address]);
  await send("adapter", "openEpoch", [EPOCH, MANIFEST, CONFIG, POLICY]);
  await send("adapter", "setAsserter", [asserter.address, true]);
  await send("token", "mint", [asserter.address, 100n * BOND]);
  await send("wormhole", "setFee", [FEE]);

  const context = (overrides: { epoch?: bigint } = {}) => ({
    version: 1,
    evm_chain_id: String(foundry.id),
    adapter: bytes(at.adapter),
    solana_program: bytes(PROGRAM),
    registry: bytes(REGISTRY),
    epoch: (overrides.epoch ?? EPOCH).toString(),
    methodology_manifest: bytes(MANIFEST),
    configuration_digest: bytes(CONFIG),
    evidence_policy: bytes(POLICY),
  });

  const record = (tag: number): EvidenceRecord => ({
    record_id: `eox:observation:${tag}`,
    evidence_digest: fill(tag),
    assessment_digest: fill(tag + 1),
  });

  const evidenceClaim = (item: EvidenceRecord, overrides: { epoch?: bigint } = {}): Hex =>
    bytesToHex(
      encodeEvidenceClaim({
        context: context(overrides),
        ...item,
        metadata_digest: fill(200),
        artifact_digests: [fill(201)],
        provenance_digests: [fill(202)],
      }),
    );

  const snapshotClaim = (proposal: Hex, precommitment: Hex, records: [EvidenceRecord, EvidenceRecord], ids: [Hex, Hex]): Hex =>
    bytesToHex(
      encodeSnapshotClaim({
        context: context(),
        proposal: bytes(proposal),
        precommitment: bytes(precommitment),
        predecessor: null,
        cutoff: "1800000000",
        slots: [
          {
            country: 0,
            indicator: 0,
            current: { ...records[0], assertion_id: bytes(ids[0]) },
            comparison: { ...records[1], assertion_id: bytes(ids[1]) },
          },
        ],
        evidence_assertions: [...ids].sort().map(bytes),
      }),
    );

  const senderFor = (name: "asserter" | "relayer"): Sender => ({
    address: wallets[name].account.address,
    send: (transaction) => wallets[name].sendTransaction(transaction),
  });

  const passAnHour = async () => {
    await test.increaseTime({ seconds: 3600 });
    await test.mine({ blocks: 1 });
  };

  return { client, test, wallets, at, abis, send, read, record, evidenceClaim, snapshotClaim, senderFor, passAnHour, stop: () => anvil.kill() };
}

export type Chain = Awaited<ReturnType<typeof startChain>>;
