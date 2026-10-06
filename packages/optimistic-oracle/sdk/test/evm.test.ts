import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type Abi,
  type Address,
  type Hex,
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ASSERTION_WINDOW_SECONDS,
  assertResult,
  cutoffTimestamp,
  decodeResultPayload,
  openEvmEpoch,
  publishResult,
  readEvmEpoch,
  resolutionUriHash,
} from "../src/index.js";
import { word } from "./golden.js";

// Runs the SDK against the adapter's real bytecode on Anvil, with the Foundry test mocks for
// UMA, Wormhole and the bond token. Build the contracts first: `forge build` in ../evm.
const OUT = fileURLToPath(new URL("../../evm/out", import.meta.url));
const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;

function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(`${OUT}/${file}/${name}.json`, "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

// Anvil's first two default accounts.
const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const asserter = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

// Anvil starts at the real current time and cannot go back, so use an epoch still ahead.
const YEAR = 2030;
const URI = "ipfs://eox-2030-snapshot";
const BOND = parseUnits("1000", 6);
const claim = {
  evidenceRoot: word("1111"),
  methodologyImageId: word("2222"),
  outputHash: word("3333"),
  resolutionUriHash: resolutionUriHash(URI),
};

describe.skipIf(!hasAnvil || !existsSync(`${OUT}/EoxAssertionAdapter.sol`))("against the adapter on Anvil", () => {
  const port = 8545 + Math.floor(Math.random() * 1000);
  const transport = http(`http://127.0.0.1:${port}`);
  const client = createPublicClient({ chain: foundry, transport });
  const test = createTestClient({ chain: foundry, transport, mode: "anvil" });
  const ownerWallet = createWalletClient({ chain: foundry, transport, account: owner });
  const asserterWallet = createWalletClient({ chain: foundry, transport, account: asserter });
  let anvil: ChildProcess;
  const at: Record<"oracle" | "wormhole" | "usdc" | "adapter", Address> = {} as never;
  const abis: Record<"oracle" | "wormhole" | "usdc", Abi> = {} as never;

  async function deploy(file: string, name: string, args: unknown[] = []): Promise<Address> {
    const { abi, bytecode } = artifact(file, name);
    const hash = await ownerWallet.deployContract({ abi, bytecode, args });
    const receipt = await client.waitForTransactionReceipt({ hash });
    return receipt.contractAddress!;
  }

  async function send(address: Address, abi: Abi, functionName: string, args: unknown[]) {
    const hash = await ownerWallet.writeContract({ address, abi, functionName, args });
    await client.waitForTransactionReceipt({ hash });
  }

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

    abis.oracle = artifact("MockOptimisticOracleV3.sol", "MockOptimisticOracleV3").abi;
    abis.wormhole = artifact("MockWormhole.sol", "MockWormhole").abi;
    abis.usdc = artifact("MockERC20.sol", "MockERC20").abi;
    at.oracle = await deploy("MockOptimisticOracleV3.sol", "MockOptimisticOracleV3", [parseUnits("500", 6)]);
    at.wormhole = await deploy("MockWormhole.sol", "MockWormhole");
    at.usdc = await deploy("MockERC20.sol", "MockERC20");
    at.adapter = await deploy("EoxAssertionAdapter.sol", "EoxAssertionAdapter", [at.oracle, at.wormhole, at.usdc, owner.address]);
    await send(at.usdc, abis.usdc, "mint", [asserter.address, 10n * BOND]);
    await send(at.wormhole, abis.wormhole, "setFee", [1_000n]);
  }, 30_000);

  afterAll(() => {
    anvil?.kill();
  });

  it("opens, asserts, settles and publishes an epoch", async () => {
    await client.waitForTransactionReceipt({
      hash: await openEvmEpoch(ownerWallet, client, at.adapter, { year: YEAR, methodologyImageId: claim.methodologyImageId, bond: BOND }),
    });
    expect(await readEvmEpoch(client, at.adapter, YEAR)).toMatchObject({ opened: true, settled: false, bond: BOND });

    await test.setNextBlockTimestamp({ timestamp: BigInt(cutoffTimestamp(YEAR) + 3600) });
    // The SDK approves the bond itself: the asserter has never approved the adapter.
    const { assertionId, hash } = await assertResult(asserterWallet, client, at.adapter, { year: YEAR, claim, resolutionUri: URI });
    await client.waitForTransactionReceipt({ hash });
    expect((await readEvmEpoch(client, at.adapter, YEAR)).activeAssertion).toBe(assertionId);

    // UMA's liveness passes with no dispute.
    await send(at.oracle, abis.oracle, "resolve", [assertionId, true]);
    const epoch = await readEvmEpoch(client, at.adapter, YEAR);
    expect(epoch.settled).toBe(true);
    expect(epoch.result).toEqual(claim);

    await client.waitForTransactionReceipt({ hash: await publishResult(asserterWallet, client, at.adapter, YEAR) });
    const payload = (await client.readContract({ address: at.wormhole, abi: abis.wormhole, functionName: "payloadAt", args: [0n] })) as Hex;
    expect(decodeResultPayload(payload)).toEqual({ year: YEAR, claim, assertionId });
  });

  it("refuses a claim whose URI hash does not match before sending anything", async () => {
    await expect(
      assertResult(asserterWallet, client, at.adapter, { year: YEAR, claim, resolutionUri: "ipfs://elsewhere" }),
    ).rejects.toThrow("resolutionUriHash");
  });

  it("surfaces the adapter's own errors", async () => {
    await test.setNextBlockTimestamp({ timestamp: BigInt(cutoffTimestamp(YEAR) + ASSERTION_WINDOW_SECONDS + 1) });
    await test.mine({ blocks: 1 });
    await expect(
      assertResult(asserterWallet, client, at.adapter, { year: YEAR, claim, resolutionUri: URI }),
    ).rejects.toThrow("EpochAlreadySettled");
  });
});
