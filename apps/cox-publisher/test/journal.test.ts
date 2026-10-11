import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptyState, Journal } from "../src/journal.js";

const identity = { program: "program", pool: "pool", genesisHash: "genesis" };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const directory = await mkdtemp(join(tmpdir(), "cox-journal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "state.json");
  return { directory, path, journal: new Journal(path, identity) };
}

test("atomic state preserves pending bytes across reopening and has restrictive permissions", async t => {
  const { path, directory, journal } = await fixture(t);
  assert.deepEqual(await journal.load(), emptyState(identity));
  const state = emptyState(identity);
  state.pending = { operationId: "operation", kind: "publish", requestId: "request", batchId: "0", sequence: "0",
    revision: "revision", unsignedBase64: "AQ==", signedBase64: "Ag==", signature: "signature",
    blockhash: "blockhash", lastValidBlockHeight: 10, expiresAt: 100, keyVersion: "version" };
  await journal.save(state);
  assert.deepEqual(await new Journal(path, identity).load(), state);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(directory), ["state.json"]);
  state.pending = null; state.lastOutcome = "submitted";
  await journal.save(state);
  assert.deepEqual(await new Journal(path, identity).load(), state);
});

test("identity mismatch and malformed state fail closed without overwriting", async t => {
  const { path, journal } = await fixture(t);
  await journal.save(emptyState(identity));
  await assert.rejects(new Journal(path, { ...identity, pool: "other" }).load(), /IdentityMismatch/);
  const before = await readFile(path, "utf8");
  await assert.rejects(journal.save({ ...emptyState(identity), identity: { ...identity, genesisHash: "other" } }), /IdentityMismatch/);
  assert.equal(await readFile(path, "utf8"), before);
  await writeFile(path, JSON.stringify({ ...emptyState(identity), pending: {} }));
  await assert.rejects(journal.load(), /InvalidPublisherJournal/);
  await writeFile(path, "{");
  await assert.rejects(journal.load(), SyntaxError);
});

test("concurrent lock contenders cannot both acquire and release is idempotent", async t => {
  const { path, journal } = await fixture(t);
  const attempts = await Promise.allSettled([journal.lock(), new Journal(path, identity).lock()]);
  assert.equal(attempts.filter(x => x.status === "fulfilled").length, 1);
  const acquired = attempts.find(x => x.status === "fulfilled");
  assert.ok(acquired?.status === "fulfilled");
  await acquired.value(); await acquired.value();
  const release = await journal.lock(); await release();
});

test("stale lock is not automatically deleted, avoiding reclaimers deleting a new live lock", async t => {
  const { path, journal } = await fixture(t);
  await writeFile(`${path}.lock`, JSON.stringify({ pid: 2147483647, token: "old" }));
  await assert.rejects(journal.lock(), /StalePublisherLock/);
  assert.equal(JSON.parse(await readFile(`${path}.lock`, "utf8")).token, "old");
});

test("release refuses a lock replaced externally", async t => {
  const { path, journal } = await fixture(t);
  const release = await journal.lock();
  await writeFile(`${path}.lock`, JSON.stringify({ pid: process.pid, token: "replacement" }));
  await assert.rejects(release(), /OwnershipLost/);
  assert.equal(JSON.parse(await readFile(`${path}.lock`, "utf8")).token, "replacement");
});

test("pending key version and signed payload/signature pairing are mandatory", async t => {
  const { journal } = await fixture(t);
  const state = emptyState(identity);
  const pending = { operationId: "operation", kind: "publish" as const, requestId: "request", batchId: "0", sequence: "0",
    revision: "revision", unsignedBase64: "AQ==", signedBase64: null, signature: null,
    blockhash: "blockhash", lastValidBlockHeight: 10, expiresAt: 100, keyVersion: "version" };
  for (const broken of [{ ...pending, keyVersion: "" }, { ...pending, keyVersion: undefined },
    { ...pending, signedBase64: "Ag==" }, { ...pending, signature: "signature" },
    { ...pending, signedBase64: "", signature: "signature" }, { ...pending, signedBase64: "Ag==", signature: "" }]) {
    await assert.rejects(journal.save({ ...state, pending: broken } as typeof state), /InvalidPublisherJournal/);
  }
  await journal.save({ ...state, pending });
  await journal.save({ ...state, pending: { ...pending, signedBase64: "Ag==", signature: "signature" } });
});
