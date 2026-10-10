import { type Hex, maxUint256, zeroAddress } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Challenger, type ChallengerState, emptyChallengerState } from "../src/challenger.js";
import { sourceSupportCheck } from "../src/checks.js";
import { type EvidenceSource, EvidenceUnavailable } from "../src/evidence-source.js";
import { BOND, type Chain, artifactOf, asserter, canRun, challenger, owner, startChain, word } from "./harness.js";

const PROPOSAL = word(0xc1);
const PRECOMMITMENT = word(0xc2);
const ARTIFACT = artifactOf(201);

describe.skipIf(!canRun)("challenger against the adapter on Anvil", () => {
  let chain: Chain;
  const state: ChallengerState = emptyChallengerState();
  const records = new Map<string, string>();
  const store = { down: false };
  const source: EvidenceSource = {
    record: async (recordId) => {
      if (store.down) throw new EvidenceUnavailable("evidence API is down");
      const artifactDigest = records.get(recordId);
      return artifactDigest ? { recordId, artifactDigest } : null;
    },
    hasArtifact: async (sha256) => sha256 === ARTIFACT,
  };

  const watcher = (dispute: boolean) =>
    new Challenger({
      client: chain.client,
      adapter: chain.at.adapter,
      sender: chain.senderFor("challenger"),
      checks: [sourceSupportCheck(source)],
      dispute,
      state,
      save: async () => undefined,
      startBlock: 0n,
    });

  async function post(tag: number): Promise<Hex> {
    const { request, result } = await chain.client.simulateContract({
      account: asserter,
      address: chain.at.adapter,
      abi: chain.abis.adapter,
      functionName: "assertEvidence",
      args: [PROPOSAL, PRECOMMITMENT, chain.evidenceClaim(chain.record(tag))],
    });
    await chain.client.waitForTransactionReceipt({ hash: await chain.wallets.asserter.writeContract(request) });
    return result as Hex;
  }

  const known = (tag: number, artifact = ARTIFACT) => records.set(`eox:observation:${tag}`, artifact);
  const disputer = async (id: Hex) => (await chain.read<{ disputer: Hex }>("oracle", "getAssertion", [id])).disputer;
  const balance = (account: Hex) => chain.read<bigint>("token", "balanceOf", [account]);

  beforeAll(async () => {
    chain = await startChain(12545);
    await chain.send("token", "approve", [chain.at.adapter, maxUint256], "asserter");
    await chain.send("token", "mint", [challenger.address, 10n * BOND]);
  }, 30_000);

  afterAll(() => chain?.stop());

  it("leaves a supported claim alone", async () => {
    known(10);
    const id = await post(10);
    expect(await watcher(true).tick()).toEqual({ checked: 1, invalid: 0, disputed: 0 });
    expect(state.claims[id]).toMatchObject({ status: "valid" });
    expect(await disputer(id)).toBe(zeroAddress);
  });

  it("only reports an unsupported claim while disputes are off", async () => {
    const id = await post(20);
    expect(await watcher(false).tick()).toEqual({ checked: 1, invalid: 1, disputed: 0 });
    expect(state.claims[id]).toMatchObject({ status: "invalid" });
    expect(state.claims[id]!.reason).toContain("eox:observation:20");
    expect(await watcher(false).tick()).toEqual({ checked: 0, invalid: 0, disputed: 0 });
    expect(await disputer(id)).toBe(zeroAddress);
  });

  it("disputes it on UMA with one bond once disputes are on", async () => {
    const id = Object.keys(state.claims).find((key) => state.claims[key]!.status === "invalid") as Hex;
    const before = await balance(challenger.address);
    expect(await watcher(true).tick()).toEqual({ checked: 0, invalid: 0, disputed: 1 });

    expect(state.claims[id]).toMatchObject({ status: "disputed" });
    expect(await disputer(id)).toBe(challenger.address);
    expect(await balance(challenger.address)).toBe(before - BOND);
    expect(await chain.read("token", "allowance", [challenger.address, chain.at.oracle])).toBe(0n);
    expect((await chain.read<{ disputed: boolean }>("adapter", "assertion", [id])).disputed).toBe(true);
  });

  it("disputes a claim that does not commit the record's source artifact", async () => {
    known(30, artifactOf(0xab));
    const id = await post(30);
    expect(await watcher(true).tick()).toEqual({ checked: 1, invalid: 1, disputed: 1 });
    expect(await disputer(id)).toBe(challenger.address);
  });

  it("waits while the evidence store is unreachable", async () => {
    known(40);
    const id = await post(40);
    store.down = true;
    expect(await watcher(true).tick()).toEqual({ checked: 1, invalid: 0, disputed: 0 });
    expect(state.claims[id]).toEqual({ claim: state.claims[id]!.claim, status: "pending", reason: "evidence API is down" });
    expect(await disputer(id)).toBe(zeroAddress);

    store.down = false;
    expect(await watcher(true).tick()).toEqual({ checked: 1, invalid: 0, disputed: 0 });
    expect(state.claims[id]).toMatchObject({ status: "valid" });
  });

  it("does not dispute what someone else already disputed", async () => {
    const id = await post(50);
    await chain.send("oracle", "dispute", [id]);
    expect(await watcher(true).tick()).toEqual({ checked: 0, invalid: 0, disputed: 0 });
    expect(state.claims[id]).toMatchObject({ status: "disputed" });
    expect(await disputer(id)).toBe(owner.address);
  });

  it("holds an invalid claim until it can afford the bond", async () => {
    const funds = await balance(challenger.address);
    await chain.send("token", "transfer", [owner.address, funds], "challenger");
    const id = await post(60);
    expect(await watcher(true).tick()).toEqual({ checked: 1, invalid: 1, disputed: 0 });
    expect(state.claims[id]).toMatchObject({ status: "invalid" });

    await chain.send("token", "mint", [challenger.address, BOND]);
    expect(await watcher(true).tick()).toEqual({ checked: 0, invalid: 0, disputed: 1 });
    expect(await disputer(id)).toBe(challenger.address);
  });

  it("records a claim whose window closed before it could act", async () => {
    const id = await post(70);
    await chain.passAnHour();
    expect(await watcher(true).tick()).toEqual({ checked: 0, invalid: 0, disputed: 0 });
    expect(state.claims[id]).toMatchObject({ status: "missed" });
    expect(await disputer(id)).toBe(zeroAddress);
  });
});
