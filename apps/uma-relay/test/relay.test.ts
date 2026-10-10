import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Hex, hexToBytes, maxUint256 } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Relay, type RelayState, emptyState } from "../src/relay.js";
import { readState, writeState } from "../src/state-file.js";
import { type Chain, FEE, asserter, canRun, startChain, word } from "./harness.js";

describe.skipIf(!canRun)("relay against the adapter on Anvil", () => {
  let chain: Chain;
  let saved: RelayState = emptyState();
  let relay: Relay;

  async function assert(functionName: "assertEvidence" | "assertSnapshot", args: unknown[]): Promise<Hex> {
    const { request, result } = await chain.client.simulateContract({
      account: asserter,
      address: chain.at.adapter,
      abi: chain.abis.adapter,
      functionName,
      args,
    });
    await chain.client.waitForTransactionReceipt({ hash: await chain.wallets.asserter.writeContract(request) });
    return result as Hex;
  }

  async function register(proposal: Hex, precommitment: Hex, tag: number) {
    const records = [chain.record(tag), chain.record(tag + 2)] as const;
    const first = await assert("assertEvidence", [proposal, precommitment, chain.evidenceClaim(records[0])]);
    const second = await assert("assertEvidence", [proposal, precommitment, chain.evidenceClaim(records[1])]);
    const claim = chain.snapshotClaim(proposal, precommitment, [records[0], records[1]], [first, second]);
    return { evidence: [first, second], snapshot: await assert("assertSnapshot", [claim]) };
  }

  const published = () => chain.read<bigint>("wormhole", "count");
  const proposalOf = (proposal: Hex) =>
    chain.read<{ closed: boolean; accepted: boolean; eventCount: bigint }>("adapter", "proposal", [proposal]);
  const newRelay = (state: RelayState) =>
    new Relay({
      client: chain.client,
      adapter: chain.at.adapter,
      sender: chain.senderFor("relayer"),
      state,
      startBlock: 0n,
      save: async (s) => void (saved = structuredClone(s)),
    });

  beforeAll(async () => {
    chain = await startChain(9545);
    await chain.send("token", "approve", [chain.at.adapter, maxUint256], "asserter");
    relay = newRelay(saved);
  }, 30_000);

  afterAll(() => chain?.stop());

  it("publishes each registration once", async () => {
    await register(word(0xc1), word(0xc2), 10);
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 3 });
    expect(await published()).toBe(3n);
    expect(await chain.client.getBalance({ address: chain.at.wormhole })).toBe(3n * FEE);
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 0 });
    expect(await published()).toBe(3n);
  });

  it("settles after the hour, closes the proposal and publishes the outcome", async () => {
    await chain.passAnHour();
    expect(await relay.tick()).toEqual({ settled: 3, closed: 1, published: 0 });
    expect(await proposalOf(word(0xc1))).toMatchObject({ closed: true, accepted: true, eventCount: 6n });
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 4 });
    expect(await published()).toBe(7n);

    const closure = await chain.read<Hex>("wormhole", "payloadAt", [6n]);
    expect(hexToBytes(closure)[176]).toBe(3);
    expect(saved.inFlight).toEqual({});
  });

  it("resumes from saved state or from the chain without repeating anything", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "uma-relay-")), "state.json");
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

    await chain.send("oracle", "dispute", [evidence[0]]);
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 1 });

    await chain.passAnHour();
    expect(await relay.tick()).toEqual({ settled: 2, closed: 0, published: 0 });
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 2 });
    expect((await proposalOf(proposal)).closed).toBe(false);

    await chain.send("oracle", "setVote", [evidence[0], false]);
    expect(await relay.tick()).toEqual({ settled: 1, closed: 1, published: 0 });
    expect(await proposalOf(proposal)).toMatchObject({ closed: true, accepted: false, eventCount: 7n });
    expect(await relay.tick()).toEqual({ settled: 0, closed: 0, published: 2 });
    expect(await published()).toBe(15n);
  });
});
