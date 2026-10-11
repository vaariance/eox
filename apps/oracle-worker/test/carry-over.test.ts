import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Journal, atomicWrite, emptyState } from "../src/journal.js";
import { retryDelay } from "../src/retry.js";

test("carry-over journal persists a complete state and prevents a second worker", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cox-carry-over-"));
  const journal = new Journal(join(directory, "state.json"));
  const state = emptyState();
  state.cursor = "preserved-cursor";
  await journal.save(state);
  assert.deepEqual(await journal.load(), state);
  const release = await journal.lock();
  await assert.rejects(journal.lock(), /JournalAlreadyInUse/);
  await release();
  await (await journal.lock())();
});

test("carry-over atomic writes preserve the destination despite abandoned temporary files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cox-atomic-"));
  const path = join(directory, "state.json");
  await atomicWrite(path, { cursor: "first" });
  await writeFile(path + ".abandoned.tmp", "partial");
  await atomicWrite(path, { cursor: "second" });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { cursor: "second" });
});

test("carry-over retry distinguishes recoverable transport errors from fatal account errors", () => {
  assert.ok(retryDelay(new Error("RPC timeout"), 0) !== null);
  assert.equal(retryDelay(new Error("AccountOwnerMismatch"), 0), null);
});
