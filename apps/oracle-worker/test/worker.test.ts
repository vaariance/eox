import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Journal, atomicWrite } from "../src/journal.js";
import { retryDelay } from "../src/retry.js";
import { FixtureProvider, assertReady, sha256 } from "../src/provider.js";
import { OracleWorker } from "../src/worker.js";
import type { EvidenceProvider, EvidenceRecord, OracleTransport, ProposalProgress, SnapshotInput } from "../src/types.js";

const artifact = Buffer.from("fixture");
const record = (id = "a", value = "1"): EvidenceRecord => ({ recordId: id, seriesId: "us-gdp", revisionId: id, country: "US", indicator: "GDP", source: "test", unit: "unit", period: "1", value, publishedAt: 1, knownAt: 1, recordedAt: 1, artifactDigest: sha256(artifact), manifest: "fixture", confidenceBps: [10_000,10_000,10_000,10_000,10_000,10_000,10_000,10_000] });
class MemoryProvider implements EvidenceProvider {
  rows = [record()];
  async readChanges(cursor: string | null) { return { cursor: String(this.rows.length), changes: this.rows.slice(Number(cursor ?? 0)).map(r => ({ changeId: r.recordId, recordId: r.recordId })) }; }
  async loadEvidence(id: string) { return this.rows.find(r => r.recordId === id)!; }
  async retrieveArtifact() { return artifact; }
}
/** Explicit test double, never exported by production or used by CLI. */
class SimulatedTransport implements OracleTransport {
  calls: SnapshotInput[] = []; status: ProposalProgress["status"] = "precommitted"; failAfterSubmit = false;
  async advance(input: SnapshotInput): Promise<ProposalProgress> {
    this.calls.push(input);
    if (this.failAfterSubmit) { this.failAfterSubmit = false; throw new Error("LostResponse"); }
    return { status: this.status, transactionSignatures: [input.proposalId], ...(this.status === "published" ? { publication: { proposalId: input.proposalId, sequence: 1, epoch: "test", methodology: "fixture", cutoff: input.cutoff, postcommittedAt: input.cutoff + 60, signature: "test-signature", finalized: true as const, snapshotAddress: input.proposalId } } : {}) };
  }
}
async function setup() { const dir = await mkdtemp(join(tmpdir(), "oracle-worker-")); const journal = new Journal(join(dir,"state.json")); const provider = new MemoryProvider(); const transport = new SimulatedTransport(); return {dir,journal,provider,transport}; }

test("readiness fails closed on unknown publication, precision and missing quality", () => {
  assert.throws(() => assertReady({...record(), publishedAt: null}, 100), /MissingPublicationTime/);
  assert.throws(() => assertReady(record("a", "0.1234561"), 100), /ExcessPrecision/);
  assertReady(record("a", "0.123456000"), 100);
  assert.throws(() => assertReady(record("a", "1000000000000.000001"), 100), /ValueOutOfRange/);
  assert.throws(() => assertReady({...record(), confidenceBps: [] as unknown as EvidenceRecord["confidenceBps"]}, 100), /InvalidConfidence/);
});
test("cursor and pending queue survive a lost transaction response and worker restart", async () => {
  const {journal,provider,transport} = await setup(); transport.failAfterSubmit = true;
  const worker = new OracleWorker(provider,transport,journal);
  await worker.tick(100); await assert.rejects(worker.tick(105), /LostResponse/);
  const saved = await journal.load(); assert.equal(saved.cursor,"1"); assert.ok(saved.active); assert.equal(saved.pending.length,0);
  await new OracleWorker(provider,transport,journal).tick(106);
  assert.equal(transport.calls[0]!.proposalId,transport.calls[1]!.proposalId);
  assert.equal((await journal.load()).seenChanges.length,1);
});
test("new arrivals queue during active proposal; rejected changes quarantine without replacing latest", async () => {
  const {journal,provider,transport} = await setup(); const worker = new OracleWorker(provider,transport,journal);
  await worker.tick(100); transport.status="published"; await worker.tick(105);
  const first=(await journal.load()).latest;
  provider.rows.push(record("b","2")); transport.status="precommitted";
  await worker.tick(106); await worker.tick(111);
  provider.rows.push(record("c","3")); await worker.tick(112);
  assert.equal((await journal.load()).pending.length,1);
  transport.status="rejected"; await worker.tick(113);
  const rejected=await journal.load(); assert.deepEqual(rejected.latest,first); assert.deepEqual(rejected.quarantine[0]!.changeIds,["b"]);
  transport.status="published"; await worker.tick(117);
  const final=await journal.load(); assert.equal(final.accepted[0]!.recordId,"c"); assert.equal(final.publications.length,2);
});
test("confidence refresh preserves accepted economic evidence and produces a new version", async () => {
  const {journal,provider,transport} = await setup(); const worker = new OracleWorker(provider,transport,journal); transport.status="published";
  await worker.tick(100); await worker.tick(105); await worker.tick(164); assert.equal(transport.calls.length,1);
  await worker.tick(165); assert.equal(transport.calls.length,2);
  assert.deepEqual(transport.calls[0]!.records,transport.calls[1]!.records); assert.notEqual(transport.calls[0]!.proposalId,transport.calls[1]!.proposalId);
  assert.equal(transport.calls[1]!.predecessor,(await journal.load()).publications[0]!.snapshotAddress);
});
test("no callback or publication for unfinalized transport output", async () => {
  const {journal,provider} = await setup(); let calls=0;
  const worker = new OracleWorker(provider,{async advance(){ return {status:"published",transactionSignatures:[]}; }},journal,()=>calls++);
  await worker.tick(100); await assert.rejects(worker.tick(105),/Unfinalized/); assert.equal(calls,0); assert.equal((await journal.load()).latest,null);
});
test("journal lock prevents two workers and releases normally", async () => {
  const {journal}=await setup(); const release=await journal.lock(); await assert.rejects(journal.lock(),/JournalAlreadyInUse/); await release(); await (await journal.lock())();
});
test("fixture detects rewritten cursor history and corrupt artifact bytes",async()=>{
  const {dir}=await setup(); const file=join(dir,"fixture.json");
  const fixture={records:[record()],changes:[{changeId:"a",recordId:"a"}],artifacts:{[sha256(artifact)]:artifact.toString("base64")}};
  await writeFile(file,JSON.stringify(fixture)); const provider=new FixtureProvider(file);
  const first=await provider.readChanges(null); assert.equal((await provider.readChanges(first.cursor)).changes.length,0);
  fixture.changes[0]!.changeId="changed"; await writeFile(file,JSON.stringify(fixture)); await assert.rejects(provider.readChanges(first.cursor),/HistoryChanged/);
  fixture.artifacts[sha256(artifact)]="YmFk"; await writeFile(file,JSON.stringify(fixture)); await assert.rejects(provider.retrieveArtifact(sha256(artifact)),/HashMismatch/);
});
test("restart progress does not reannounce already journaled publication",async()=>{
  const {journal,provider,transport}=await setup(); transport.status="published"; let n=0;
  await new OracleWorker(provider,transport,journal,()=>n++).tick(100);
  await new OracleWorker(provider,transport,journal,()=>n++).tick(105);
  await new OracleWorker(provider,transport,journal,()=>n++).tick(106); assert.equal(n,1);
  assert.equal(JSON.parse(await readFile(journal.path,"utf8")).publications.length,1);
});
test("incomplete baseline stays queued until all configured slots arrive",async()=>{
  const {journal,provider,transport}=await setup();
  const worker=new OracleWorker(provider,transport,journal,()=>{}, {batchSeconds:5,refreshSeconds:60},["US/GDP","JP/GDP"]);
  await worker.tick(100);await worker.tick(105);assert.equal(transport.calls.length,0);assert.equal((await journal.load()).active,null);
  provider.rows.push({...record("jp"),country:"JP",seriesId:"jp-gdp"});await worker.tick(106);assert.equal(transport.calls.length,1);assert.equal(transport.calls[0]!.records.length,2);
});
test("new delivery id for identical record does not create a second update",async()=>{
  const {journal,provider,transport}=await setup(); transport.status="published";
  const worker=new OracleWorker(provider,transport,journal);await worker.tick(100);await worker.tick(105);
  provider.readChanges=async()=>({cursor:"2",changes:[{changeId:"duplicate-delivery",recordId:"a"}]});
  await worker.tick(106);await worker.tick(111);assert.equal(transport.calls.length,1);assert.equal((await journal.load()).pending.length,0);
});
test("atomic writes ignore abandoned temporary files and preserve readable destinations",async()=>{
  const {dir}=await setup();const path=join(dir,"binding.json");
  await atomicWrite(path,{sequence:"1"});await writeFile(`${path}.${process.pid}.tmp`,"{interrupted");
  assert.deepEqual(JSON.parse(await readFile(path,"utf8")),{sequence:"1"});
  await atomicWrite(path,{sequence:"2"});assert.deepEqual(JSON.parse(await readFile(path,"utf8")),{sequence:"2"});
});
test("RPC failures back off, pause waits, readiness and account conflicts remain fatal",()=>{
  assert.equal(retryDelay(new Error("fetch failed"),1),2000);assert.equal(retryDelay(new Error("503"),20),30000);
  assert.equal(retryDelay(new Error("OraclePaused"),1),30000);
  for(const message of ["MissingPublicationTime:a","InvalidConfidence:a","SlotRetryConflict","EpochConfigurationConflict","Math"])assert.equal(retryDelay(new Error(message),1),null);
});

for (const stage of ["draft", "precommitted", "postcommitted", "calculating", "published", "rejected", "cancelled", "expired"] as const) {
  test(`restart after a lost ${stage} response preserves queued evidence and proposal identity`, async () => {
    const {journal, provider, transport} = await setup();
    await new OracleWorker(provider, transport, journal).tick(100);
    transport.status = stage;
    transport.failAfterSubmit = true;
    await assert.rejects(new OracleWorker(provider, transport, journal).tick(105), /LostResponse/);
    const proposal = (await journal.load()).active!;
    provider.rows.push(record("next", "2"));
    await new OracleWorker(provider, transport, journal).tick(106);
    const recovered = await journal.load();
    assert.equal(transport.calls.at(-1)!.proposalId, proposal.proposalId);
    assert.deepEqual(recovered.pending.map(change => change.record.recordId), ["next"]);
    assert.equal(recovered.cursor, "2");
    if (stage === "published") {
      assert.equal(recovered.publications.length, 1);
      assert.equal(recovered.accepted[0]!.recordId, "a");
    } else if (["rejected", "cancelled", "expired"].includes(stage)) {
      assert.equal(recovered.latest, null);
      assert.deepEqual(recovered.quarantine[0]!.changeIds, ["a"]);
    } else {
      assert.equal(recovered.active!.proposalId, proposal.proposalId);
      assert.equal(recovered.latest, null);
    }
  });
}
