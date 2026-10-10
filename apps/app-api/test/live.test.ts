import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import anchor, { type Idl, type Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import { ReferenceReader } from "@eox/oracle-worker/references";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublicationIndexer, type ChainClient, type FinalizedTransaction, type PublicationEvent, type SignatureEntry } from "../src/indexer.js";
import { LiveReferenceSource } from "../src/live-source.js";
import { ReadinessTracker, slotStatus, type SlotFact } from "../src/readiness.js";

const here = dirname(fileURLToPath(import.meta.url));
const idl = JSON.parse(await readFile(join(here, "..", "..", "..", "packages", "oracle", "idl", "eox_oracle.json"), "utf8")) as Idl;

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "eox-app-api-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const event = (sequence: string): PublicationEvent => ({
  snapshot: `snapshot-${sequence}`,
  epoch: "epoch-1",
  sequence,
  evidenceCutoff: "100",
  evaluationTime: "160",
  postcommitment: "ab".repeat(32),
});

class FakeChain implements ChainClient {
  signatures: SignatureEntry[] = [];
  transactions = new Map<string, FinalizedTransaction | null>();
  events = new Map<string, PublicationEvent[]>();
  confirmed = true;

  async signaturesAfter(last: string | null): Promise<SignatureEntry[]> {
    const index = last === null ? -1 : this.signatures.findIndex((entry) => entry.signature === last);
    return this.signatures.slice(index + 1);
  }
  async transaction(signature: string) {
    return this.transactions.get(signature) ?? null;
  }
  publishedEvents(logs: string[]) {
    return logs.flatMap((log) => this.events.get(log) ?? []);
  }
  async confirmPublished() {
    return this.confirmed;
  }
  add(signature: string, slot: number, events: PublicationEvent[], failed = false) {
    this.signatures.push({ signature, slot, failed });
    this.transactions.set(signature, { slot, blockTime: slot * 10, failed, logs: [signature] });
    this.events.set(signature, events);
  }
}

describe("publication indexer", () => {
  it("indexes finalized publications in sequence order and resumes from saved state", async () => {
    const chain = new FakeChain();
    chain.add("sig-a", 10, [event("1")]);
    chain.add("sig-b", 11, []);
    chain.add("sig-c", 12, [event("0")]);
    const indexer = new PublicationIndexer(chain, join(directory, "publications.json"));
    await indexer.load();
    const seen: string[] = [];
    indexer.onPublication((publication) => seen.push(publication.sequence));
    expect(await indexer.tick()).toBe(2);
    expect(indexer.publications().map((p) => [p.sequence, p.signature, p.slot])).toEqual([["0", "sig-c", 12], ["1", "sig-a", 10]]);
    expect(seen).toEqual(["1", "0"]);

    chain.add("sig-d", 13, [event("2"), event("1")]);
    const resumed = new PublicationIndexer(chain, join(directory, "publications.json"));
    await resumed.load();
    expect(await resumed.tick()).toBe(1);
    expect(resumed.publications().map((p) => p.sequence)).toEqual(["0", "1", "2"]);
    expect(await resumed.tick()).toBe(0);
  });

  it("skips failed transactions", async () => {
    const chain = new FakeChain();
    chain.add("failed-entry", 10, [event("0")], true);
    chain.signatures.push({ signature: "failed-meta", slot: 11, failed: false });
    chain.transactions.set("failed-meta", { slot: 11, blockTime: null, failed: true, logs: ["failed-meta"] });
    chain.events.set("failed-meta", [event("1")]);
    const indexer = new PublicationIndexer(chain, join(directory, "publications.json"));
    expect(await indexer.tick()).toBe(0);
    expect(indexer.publications()).toEqual([]);
  });

  it("stops without advancing when a transaction is not finalized or the account disagrees", async () => {
    const chain = new FakeChain();
    chain.add("sig-a", 10, [event("0")]);
    chain.signatures.push({ signature: "sig-pending", slot: 11, failed: false });
    const indexer = new PublicationIndexer(chain, join(directory, "publications.json"));
    await expect(indexer.tick()).rejects.toThrow(/not available yet/);
    expect(indexer.publications().map((p) => p.sequence)).toEqual(["0"]);

    const mismatched = new FakeChain();
    mismatched.add("sig-x", 10, [event("0")]);
    mismatched.confirmed = false;
    const strict = new PublicationIndexer(mismatched, join(directory, "strict.json"));
    await expect(strict.tick()).rejects.toThrow(/does not match/);
    expect(strict.publications()).toEqual([]);
  });
});

const fact = (overrides: Partial<SlotFact> = {}): SlotFact => ({
  recordId: "eox:observation:1",
  country: "US",
  indicator: "policy_rate",
  periodOrdinal: "100",
  recordedAt: 1_000,
  value: "4.250000",
  rawValue: "4.25",
  publishedAt: 1_000,
  ...overrides,
});

describe("evidence readiness", () => {
  it("applies the worker's readiness rules and never claims a confidence assessment", () => {
    expect(slotStatus(undefined, 2_000)).toBe("missing-record");
    expect(slotStatus(fact({ publishedAt: null }), 2_000)).toBe("missing-publication-time");
    expect(slotStatus(fact({ publishedAt: 3_000 }), 2_000)).toBe("invalid-publication-time");
    expect(slotStatus(fact({ rawValue: "2.123456789" }), 2_000)).toBe("excess-precision");
    expect(slotStatus(fact({ rawValue: "2.123456000" }), 2_000)).toBe("missing-assessment");
    expect(slotStatus(fact(), 2_000)).toBe("missing-assessment");
  });

  it("follows the change feed and keeps the latest period, then the latest revision, per slot", async () => {
    const records: Record<string, unknown> = {
      "eox:observation:1": { ...fact(), recordId: "eox:observation:1" },
      "eox:observation:2": { ...fact(), recordId: "eox:observation:2", periodOrdinal: "101" },
      "eox:observation:3": { ...fact(), recordId: "eox:observation:3", periodOrdinal: "99", recordedAt: 5_000 },
      "eox:observation:4": { ...fact(), recordId: "eox:observation:4", periodOrdinal: "101", recordedAt: 1_500 },
      "eox:observation:5": { ...fact(), recordId: "eox:observation:5", country: "JP", indicator: "gdp_real_volume" },
    };
    const pages: Record<string, unknown> = {
      start: { cursor: "c1", changes: [{ recordId: "eox:observation:1" }, { recordId: "eox:observation:2" }] },
      c1: { cursor: "c2", changes: [] },
      c2: { cursor: "c3", changes: [{ recordId: "eox:observation:3" }, { recordId: "eox:observation:4" }, { recordId: "eox:observation:5" }] },
      c3: { cursor: "c3", changes: [] },
    };
    const requests: string[] = [];
    const fetchJson = async (url: string) => {
      const parsed = new URL(url);
      requests.push(parsed.pathname);
      if (parsed.pathname === "/v1/changes") return pages[parsed.searchParams.get("cursor") ?? "start"];
      return records[decodeURIComponent(parsed.pathname.slice("/v1/records/".length))];
    };
    const tracker = new ReadinessTracker("http://evidence.test", join(directory, "readiness.json"), fetchJson);
    await tracker.load();
    expect(await tracker.tick()).toBe(5);
    const readiness = tracker.readiness(2_000);
    expect(readiness.slots).toHaveLength(180);
    expect(readiness.slots.find((s) => s.country === "US" && s.indicator === "policy_rate")).toMatchObject({ recordId: "eox:observation:4", status: "missing-assessment" });
    expect(readiness.slots.find((s) => s.country === "JP" && s.indicator === "gdp_real_volume")?.recordId).toBe("eox:observation:5");
    expect(readiness.slots.filter((s) => s.status === "missing-record")).toHaveLength(178);

    const resumed = new ReadinessTracker("http://evidence.test", join(directory, "readiness.json"), fetchJson);
    await resumed.load();
    requests.length = 0;
    expect(await resumed.tick()).toBe(0);
    expect(requests).toEqual(["/v1/changes"]);
  });

  it("rejects malformed evidence responses", async () => {
    const tracker = new ReadinessTracker("http://evidence.test", join(directory, "bad.json"), async (url) =>
      url.includes("/v1/changes") ? { cursor: "c1", changes: [{ recordId: "../../etc" }] } : {},
    );
    await expect(tracker.tick()).rejects.toThrow(/malformed evidence change/);
  });
});

const bn = (n: number) => new anchor.BN(n);
const hash = (byte: number) => Array(32).fill(byte);

async function chainFixture() {
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const connection = new Connection("http://127.0.0.1:8899");
  connection.getAccountInfo = async (key) => accounts.get(key.toBase58()) ?? null;
  const program: Program = new anchor.Program(idl, { connection });
  const pda = (...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const registry = pda(Buffer.from("registry"));
  const epoch = pda(Buffer.from("epoch"), bn(1).toArrayLike(Buffer, "le", 8));
  const snapshot = (sequence: number) => pda(Buffer.from("snapshot"), epoch.toBytes(), bn(sequence).toArrayLike(Buffer, "le", 8));
  const country = { normalizedSum: bn(0), confidenceSum: bn(1_000_000), weightSum: bn(1), complete: true, state: bn(100_000_000), confidence: bn(1_000_000), saturated: false, stale: false, ratio: bn(1_000_000), change: bn(0), expressed: bn(100_000_000), referenceConfidence: bn(1_000_000) };
  const baseSnapshot = { registry, epoch, sequence: bn(0), cutoff: bn(100), predecessor: PublicKey.default, adapter: PublicKey.default, status: 4, frozenPages: 2, calculatedPages: 2, evidenceDigest: hash(1), precommitment: hash(2), postcommitment: hash(3), deadline: bn(160), evaluationTime: bn(161), publishedAt: bn(162), eventDigest: hash(4), eventCount: bn(0), pending: 0, closed: true, countries: [country, country], world: bn(100_000_000), worldConfidence: bn(1_000_000) };
  const epochAccount = { registry, id: bn(1), countries: [[85, 83], [74, 80]], indicatorCounts: Buffer.from([1, 1]), multiplier: 20, configurationDigest: hash(9), rulePages: 2, sealed: true, baseline: [bn(100_000_000), bn(100_000_000)], baselineWorld: bn(100_000_000), baselineSnapshot: snapshot(0) };
  const registryAccount = { authority: PublicKey.default, adapter: PublicKey.default, paused: false, active: PublicKey.default, latest: snapshot(0), nextSequence: bn(1), historyDigest: hash(5) };
  const put = async (name: string, key: PublicKey, value: unknown) =>
    accounts.set(key.toBase58(), { data: await program.coder.accounts.encode(name, value), owner: program.programId, executable: false, lamports: 1, rentEpoch: 0 });
  await put("registry", registry, registryAccount);
  await put("epoch", epoch, epochAccount);
  await put("snapshot", snapshot(0), baseSnapshot);
  return { connection, program, reader: new ReferenceReader(program), put, registry, epoch, snapshot, baseSnapshot, registryAccount };
}

describe("live reference source", () => {
  it("maps a finalized on-chain snapshot to the app identity without inventing fields", async () => {
    const f = await chainFixture();
    const chain = new FakeChain();
    const address = f.snapshot(0).toBase58();
    chain.add("sig-0", 42, [{ ...event("0"), snapshot: address }]);
    const indexer = new PublicationIndexer(chain, join(directory, "publications.json"));
    await indexer.tick();
    const source = new LiveReferenceSource({
      network: "solana-test",
      connection: f.connection,
      program: f.program,
      reader: f.reader,
      indexer,
      readiness: async () => ({ evaluatedAt: 0, slots: [] }),
      onError: (error) => { throw error; },
    });
    const [published] = await source.publications();
    expect(published!.identity).toEqual({
      snapshotId: address,
      sequence: 0,
      epoch: "1",
      epochAddress: f.epoch.toBase58(),
      configurationDigest: "09".repeat(32),
      baselineId: address,
      predecessor: null,
      cutoff: 100,
      postcommittedAt: 161,
      publishedAt: 162,
      evidenceDigest: "01".repeat(32),
      precommitment: "02".repeat(32),
      postcommitment: "03".repeat(32),
      challengeEventDigest: "04".repeat(32),
      challengeEventCount: 0,
      finalization: { transaction: "sig-0", slot: 42, finalized: true },
    });
    expect(published!.countries.map((c) => c.country)).toEqual(["US", "JP"]);
    expect(published!.world).toEqual({ state: "100000000", confidence: "1000000", baseline: "100000000" });
    expect(await source.deployment()).toMatchObject({ origin: "live", registry: f.registry.toBase58(), fixtureSource: null });
    expect(await source.pair(published!, "US", "US")).toBeNull();
    expect(await source.pair(published!, "US", "FR")).toBeNull();
    expect(await source.paused()).toBe(false);
    expect(await source.proposal()).toBeNull();
  });

  it("reports the active proposal state from the registry", async () => {
    const f = await chainFixture();
    const pending = f.snapshot(1);
    await f.put("snapshot", pending, { ...f.baseSnapshot, sequence: bn(1), status: 1, predecessor: f.snapshot(0), cutoff: bn(200) });
    await f.put("registry", f.registry, { ...f.registryAccount, active: pending, paused: true });
    const source = new LiveReferenceSource({
      network: "solana-test",
      connection: f.connection,
      program: f.program,
      reader: f.reader,
      indexer: new PublicationIndexer(new FakeChain(), join(directory, "publications.json")),
      readiness: async () => ({ evaluatedAt: 0, slots: [] }),
      onError: (error) => { throw error; },
    });
    expect(await source.paused()).toBe(true);
    expect(await source.proposal()).toEqual({
      proposalId: pending.toBase58(),
      epoch: "1",
      predecessor: f.snapshot(0).toBase58(),
      cutoff: 200,
      state: "precommitted",
      assertions: [],
    });
  });
});
