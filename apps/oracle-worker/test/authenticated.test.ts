import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { AuthenticatedProgress, ReceiverAddresses, evidenceClaimUpload, instructionDigest, snapshotClaimUpload, transactionSize } from "../src/authenticated.js";
import type { EvidenceClaim, SnapshotClaim } from "../src/protocol.js";

const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const binding = { program: key(1).toBase58(), proposal: key(2).toBase58(), receiver: key(3).toBase58() };
const instruction = () => new TransactionInstruction({ programId: key(1), keys: [{ pubkey: key(2), isSigner: false, isWritable: true }], data: Buffer.from([1, 2, 3]) });
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "eox-authenticated-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "proposal.json");
  return { path, progress: new AuthenticatedProgress(path, binding) };
}

test("claim upload bytes and hashes preserve task 1 vectors", async () => {
  const corpus = JSON.parse(await readFile(new URL("../../../packages/oracle/fixtures/protocol-v1.json", import.meta.url), "utf8"));
  let checked = 0;
  for (const vector of corpus.vectors) {
    if (vector.kind !== "evidence" && vector.kind !== "snapshot") continue;
    checked++;
    const upload = vector.kind === "evidence" ? evidenceClaimUpload(vector.input as EvidenceClaim) : snapshotClaimUpload(vector.input as SnapshotClaim);
    assert.equal(upload.bytes.toString("hex"), vector.encodedHex);
    assert.equal(Buffer.from(upload.digest).toString("hex"), vector.sha256);
  }
  assert.equal(checked, 3);
});

test("persist intent before submission and resume finalized operation without resubmission", async t => {
  const f = await fixture(t); let complete = false; let sends = 0;
  const operation = { id: "claim:0", instruction: instruction(), finalized: async () => complete };
  const result = await f.progress.run(operation, async () => {
    const state = JSON.parse(await readFile(f.path, "utf8"));
    assert.equal(state.operations[operation.id].complete, false);
    sends++; complete = true; return "signature";
  });
  assert.deepEqual(result, { signature: "signature", recovered: false });
  assert.deepEqual(await new AuthenticatedProgress(f.path, binding).run(operation, async () => { throw new Error("MustNotSend"); }), { signature: "signature", recovered: true });
  assert.equal(sends, 1);
});

test("lost submit response recovers by observing finalized chain state", async t => {
  const f = await fixture(t); let complete = false;
  const operation = { id: "registration:1", instruction: instruction(), finalized: async () => complete };
  await assert.rejects(f.progress.run(operation, async () => { complete = true; throw new Error("ConnectionLost"); }), /ConnectionLost/);
  assert.deepEqual(await new AuthenticatedProgress(f.path, binding).run(operation, async () => { throw new Error("MustNotSend"); }), { signature: null, recovered: true });
});

test("interrupted before finality retries identical instruction after restart", async t => {
  const f = await fixture(t); let complete = false;
  const operation = { id: "binding:0", instruction: instruction(), finalized: async () => complete };
  await assert.rejects(f.progress.run(operation, async () => "pending-signature"), /NotFinalized/);
  const result = await new AuthenticatedProgress(f.path, binding).run(operation, async ix => { assert.equal(instructionDigest(ix), instructionDigest(operation.instruction)); complete = true; return "retry-signature"; });
  assert.deepEqual(result, { signature: "retry-signature", recovered: false });
});

test("changed instruction or proposal binding cannot reuse durable operation", async t => {
  const f = await fixture(t);
  const operation = { id: "claim:0", instruction: instruction(), finalized: async () => true };
  await f.progress.run(operation, async () => "unused");
  const changed = instruction(); changed.data[0] = 4;
  await assert.rejects(f.progress.run({ ...operation, instruction: changed }, async () => "unused"), /OperationConflict/);
  await assert.rejects(new AuthenticatedProgress(f.path, { ...binding, proposal: key(5).toBase58() }).run(operation, async () => "unused"), /BindingConflict/);
});

test("finalized journal state never silently falls back to resubmission", async t => {
  const f = await fixture(t); const operation = { id: "close", instruction: instruction(), finalized: async () => true };
  await f.progress.run(operation, async () => "unused");
  await assert.rejects(f.progress.run({ ...operation, finalized: async () => false }, async () => "unused"), /FinalizedAuthenticatedStateMissing/);
});

test("instruction identity includes account privileges and rejects wrong destination", async t => {
  const f = await fixture(t); const base = instruction(); const changed = instruction(); changed.keys[0]!.isWritable = false;
  assert.notEqual(instructionDigest(base), instructionDigest(changed));
  assert.ok(transactionSize(base, key(9)) < 1232);
  changed.programId = key(4);
  await assert.rejects(f.progress.run({ id: "x", instruction: changed, finalized: async () => true }, async () => "unused"), /ProgramMismatch/);
  await assert.rejects(f.progress.run({ id: "__proto__", instruction: base, finalized: async () => true }, async () => "unused"), /InvalidAuthenticatedOperationId/);
});

test("full snapshot plan is immutable before transaction progress", async t => {
  const f = await fixture(t);
  await f.progress.freezePlan("snapshot-claim", "ab".repeat(32));
  await new AuthenticatedProgress(f.path, binding).freezePlan("snapshot-claim", "ab".repeat(32));
  await assert.rejects(new AuthenticatedProgress(f.path, binding).freezePlan("snapshot-claim", "cd".repeat(32)), /AuthenticatedPlanConflict/);
  const stored = JSON.parse(await readFile(f.path, "utf8"));
  assert.deepEqual(stored.operations, {});
});

test("assertion identity spans configurations while membership remains proposal-specific", () => {
  const a = new ReceiverAddresses(key(1), key(2), key(3), "1", "11155111", Array(20).fill(4));
  const b = new ReceiverAddresses(key(1), key(2), key(5), "2", "11155111", Array(20).fill(4));
  const id = Array(32).fill(6);
  assert.ok(a.assertion(id).equals(b.assertion(id)));
  assert.ok(!a.receiver.equals(b.receiver));
  assert.ok(!a.membership(id).equals(b.membership(id)));
  assert.ok(!a.binding(0, 0, false).equals(a.binding(0, 0, true)));
  assert.throws(() => a.page(30, 0), /InvalidReceiverSlot/);
  assert.throws(() => a.assertion([1]), /InvalidReceiverBytes/);
});
