import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import anchor, { type Idl, type Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import { ReferenceReader, decodeReferenceAccount } from "../src/references.js";

const idl = JSON.parse(await readFile(new URL("../../../packages/oracle/idl/eox_oracle.json", import.meta.url), "utf8")) as Idl;
const bn = (n: number) => new anchor.BN(n);
const empty = PublicKey.default;
const hash = Array(32).fill(1);
async function fixture() {
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const connection = new Connection("http://127.0.0.1:8899");
  connection.getAccountInfo = async (key, commitment) => { assert.equal(commitment, "finalized"); return accounts.get(key.toBase58()) ?? null; };
  let returnData = { programId: idl.address, data: [Buffer.concat([1_000_000n, 0n, 100_000_000n, 1_000_000n].map(n => { const b = Buffer.alloc(8); b.writeBigInt64LE(n); return b; })).toString("base64"), "base64"] as [string, "base64"] };
  const program: Program = new anchor.Program(idl, { connection, simulate: async tx => {
    assert.ok("instructions" in tx);
    assert.equal(tx.instructions[0]!.keys[0]!.pubkey.toBase58(), epoch.toBase58());
    return { logs: [], returnData };
  } });
  const pda = (...seeds: Uint8Array[]): PublicKey => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const registry = pda(Buffer.from("registry"));
  const epoch = pda(Buffer.from("epoch"), bn(1).toArrayLike(Buffer, "le", 8));
  const snapshot = pda(Buffer.from("snapshot"), epoch.toBytes(), bn(1).toArrayLike(Buffer, "le", 8));
  const country = { normalizedSum: bn(0), confidenceSum: bn(1_000_000), weightSum: bn(1), complete: true, state: bn(100_000_000), confidence: bn(1_000_000), saturated: false, stale: false, ratio: bn(1_000_000), change: bn(0), expressed: bn(100_000_000), referenceConfidence: bn(1_000_000) };
  const s = { registry, epoch, sequence: bn(1), cutoff: bn(100), predecessor: empty, adapter: empty, status: 4, frozenPages: 2, calculatedPages: 2, evidenceDigest: hash, precommitment: hash, postcommitment: hash, deadline: bn(160), evaluationTime: bn(161), publishedAt: bn(162), eventDigest: hash, eventCount: bn(0), pending: 0, closed: true, countries: [country, country], world: bn(100_000_000), worldConfidence: bn(1_000_000) };
  const e = { registry, id: bn(1), countries: [[85,83],[74,80]], indicatorCounts: Buffer.from([1,1]), multiplier: 20, configurationDigest: hash, rulePages: 2, sealed: true, baseline: [bn(100_000_000), bn(100_000_000)], baselineWorld: bn(100_000_000), baselineSnapshot: snapshot };
  const r = { authority: empty, adapter: empty, paused: false, active: empty, latest: snapshot, nextSequence: bn(2), historyDigest: hash };
  const put = async (name: string, key: PublicKey, value: unknown) => accounts.set(key.toBase58(), { data: await program.coder.accounts.encode(name, value), owner: program.programId, executable: false, lamports: 1, rentEpoch: 0 });
  await put("registry", registry, r); await put("epoch", epoch, e); await put("snapshot", snapshot, s);
  return { reader: new ReferenceReader(program), program, accounts, put, snapshot, epoch, registry, s, e, r, setReturn: (value: typeof returnData) => { returnData = value; } };
}

test("IDL account bytes decode and published values retain exact scaled strings", async () => {
  const f = await fixture();
  assert.equal(decodeReferenceAccount(f.program, "snapshot", f.accounts.get(f.snapshot.toBase58())!).sequence.toString(), "1");
  const result = await f.reader.readSnapshot();
  assert.equal(result.world.state, "100000000");
  assert.equal(result.countries[0]!.reference.expressed, "100000000");
  assert.equal(result.baselineSnapshot, f.snapshot.toBase58());
  assert.equal(result.postcommittedAt, "161");
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("pending work and a later epoch do not invalidate a historical reference", async () => {
  const f = await fixture();
  await f.put("registry", f.registry, { ...f.r, active: new PublicKey(new Uint8Array(32).fill(3)), latest: new PublicKey(new Uint8Array(32).fill(4)) });
  assert.equal((await f.reader.readSnapshot(f.snapshot.toBase58())).epochId, "1");
});

test("reject unpublished, incomplete, mismatched registry and baseline accounts", async () => {
  for (const patch of [{ status: 1 }, { closed: false }, { countries: [] }, { registry: empty }]) {
    const f = await fixture(); await f.put("snapshot", f.snapshot, { ...f.s, ...patch });
    await assert.rejects(f.reader.readSnapshot());
  }
  const f = await fixture(); await f.put("epoch", f.epoch, { ...f.e, baseline: [bn(1), bn(1)] });
  await assert.rejects(f.reader.readSnapshot(), /BaselineMismatch/);
});

test("reject missing, wrong-owner and wrong-PDA references", async () => {
  const f = await fixture();
  f.accounts.get(f.snapshot.toBase58())!.owner = empty;
  await assert.rejects(f.reader.readSnapshot(), /AccountOwnerMismatch/);
  await f.put("snapshot", f.snapshot, { ...f.s, sequence: bn(2) });
  await assert.rejects(f.reader.readSnapshot(), /ReferenceIdentityMismatch/);
  f.accounts.delete(f.snapshot.toBase58());
  await assert.rejects(f.reader.readSnapshot(), /SNAPSHOT_NOT_FOUND/);
  await f.put("registry", f.registry, { ...f.r, latest: empty });
  await assert.rejects(f.reader.readSnapshot(), /NO_ACCEPTED_REFERENCE/);
});

test("pair reader retains on-chain calculation and validates returned program and byte length", async () => {
  const f = await fixture();
  const pair = await f.reader.readPair(f.snapshot.toBase58(), 0, 1);
  assert.deepEqual(pair, { snapshot: f.snapshot.toBase58(), epoch: f.epoch.toBase58(), base: "US", quote: "JP", ratio: "1000000", change: "0", expressed: "100000000", confidence: "1000000" });
  await assert.rejects(f.reader.readPair(f.snapshot.toBase58(), 0, 0), /INVALID_PAIR/);
  f.setReturn({ programId: empty.toBase58(), data: ["", "base64"] });
  await assert.rejects(f.reader.readPair(f.snapshot.toBase58(), 0, 1), /MissingPairReturnData/);
  f.setReturn({ programId: idl.address, data: ["", "base64"] });
  await assert.rejects(f.reader.readPair(f.snapshot.toBase58(), 0, 1), /InvalidPairReturnData/);
});

test("Rust-generated baseline and changed-country outputs survive account decoding unchanged", async () => {
  interface Scenario {
    baseline: string[];
    countries: string[];
    states: { state: string; confidence: string; saturated: boolean; stale: boolean }[];
    references: { ratio: string; change: string; expressed: string; confidence: string }[];
    pairs: { base: string; quote: string; ratio: string; change: string; expressed: string; confidence: string }[];
    world: { state: string; confidence: string };
  }
  const corpus = JSON.parse(await readFile(new URL("../../app-api/fixtures/oracle-preview.json", import.meta.url), "utf8")) as { scenarios: Scenario[] };
  const f = await fixture();
  const baseline = corpus.scenarios[0]!;
  const output = (scenario: Scenario) => scenario.states.map((s, i) => ({ ...f.s.countries[0]!, state: new anchor.BN(s.state), confidence: new anchor.BN(s.confidence), saturated: s.saturated, stale: s.stale,
    ratio: new anchor.BN(scenario.references[i]!.ratio), change: new anchor.BN(scenario.references[i]!.change), expressed: new anchor.BN(scenario.references[i]!.expressed), referenceConfidence: new anchor.BN(scenario.references[i]!.confidence) }));
  await f.put("epoch", f.epoch, { ...f.e, countries: baseline.countries.map(c => [...Buffer.from(c)]), indicatorCounts: Buffer.from([4,4,4,4]), rulePages: 4, baseline: baseline.baseline.map(n => new anchor.BN(n)), baselineWorld: new anchor.BN(baseline.world.state) });
  await f.put("snapshot", f.snapshot, { ...f.s, frozenPages: 4, calculatedPages: 4, countries: output(baseline) });
  for (const [i, scenario] of corpus.scenarios.entries()) {
    const key = PublicKey.findProgramAddressSync([Buffer.from("snapshot"), f.epoch.toBytes(), bn(i + 1).toArrayLike(Buffer, "le", 8)], f.program.programId)[0];
    await f.put("snapshot", key, { ...f.s, sequence: bn(i + 1), frozenPages: 4, calculatedPages: 4, predecessor: i === 0 ? empty : f.snapshot, countries: output(scenario), world: new anchor.BN(scenario.world.state), worldConfidence: new anchor.BN(scenario.world.confidence) });
    const actual = await f.reader.readSnapshot(key.toBase58());
    assert.equal(actual.world.state, scenario.world.state);
    for (const [j, country] of actual.countries.entries()) {
      assert.equal(country.state, scenario.states[j]!.state);
      assert.equal(country.confidence, scenario.states[j]!.confidence);
      assert.equal(country.reference.ratio, scenario.references[j]!.ratio);
      assert.equal(country.reference.change, scenario.references[j]!.change);
      assert.equal(country.reference.expressed, scenario.references[j]!.expressed);
    }
    const pair = scenario.pairs.find(p => p.base === "US" && p.quote === "JP")!;
    const data = Buffer.concat([pair.ratio, pair.change, pair.expressed, pair.confidence].map(n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }));
    f.setReturn({ programId: idl.address, data: [data.toString("base64"), "base64"] });
    const returned = await f.reader.readPair(key.toBase58(), 0, 1);
    assert.equal(returned.expressed, pair.expressed);
    assert.equal(returned.ratio, pair.ratio);
  }
});
