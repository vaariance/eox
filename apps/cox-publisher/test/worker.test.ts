import assert from "node:assert/strict";
import test from "node:test";
import { emptyState } from "../src/journal.js";
import { operationId, Publisher } from "../src/worker.js";
import type { ChainView, Operation, PublisherState, Stage } from "../src/types.js";

const identity = { program: "program", pool: "pool", genesisHash: "genesis" };
const policy = { assets: [], origin: 120n, bybit: false, digest: "method" };
function setup() {
  let now = 181n;
  let state: PublisherState = emptyState(identity);
  const view: ChainView = { paused: false, initialized: true, origin: 120n, lastBatch: 0n,
    sequence: 0n, stateDigest: "accepted", stage: null };
  const operations: Operation[] = [];
  const calls: string[] = [];
  let unresolved = false;
  let snapshot = { cutoff: 180n, digest: "snapshot", archiveTime: 181n, prices: [] };
  const options = { identity, policy, clock: { nowSeconds: () => now },
    store: { load: async () => state, save: async (next: PublisherState) => { state = next; } },
    archive: { snapshot: async () => { calls.push("archive"); return snapshot; } },
    chain: { recover: async () => { calls.push("recover"); return unresolved; },
      view: async () => { calls.push("view"); return view; },
      submit: async (op: Operation) => { calls.push("submit"); operations.push(op); } } };
  return { options, view, operations, calls, worker: new Publisher(options), state: () => state,
    now: (value: bigint) => { now = value; }, pending: (value: boolean) => { unresolved = value; },
    snapshot: (value: typeof snapshot) => { snapshot = value; } };
}
function stage(phase: Stage["phase"], cursor = 0n): Stage {
  return { phase, cursor, closedQueueEnd: 1n, batchId: 1n, sequence: 1n, cutoff: 180n, revision: "revision" };
}

test("recover pending first and preserve it through a paused tick", async () => {
  const s = setup();
  s.pending(true); s.view.paused = true;
  assert.equal(await s.worker.tick(), "pending");
  assert.deepEqual(s.calls, ["recover"]);
  s.pending(false);
  assert.equal(await s.worker.tick(), "paused");
  assert.equal(s.operations.length, 0);
});

test("publishes the current minute and relies on chain after restart", async () => {
  const s = setup();
  assert.equal(await s.worker.tick(), "submitted");
  const op = s.operations[0];
  assert.equal(op.kind, "publish"); assert.equal(op.batchId, 1n); assert.equal(op.sequence, 1n);
  assert.equal(s.state().lastCutoff, "180");
  await new Publisher(s.options).tick();
  assert.equal(s.operations[1].id, op.id);
  s.view.lastBatch = 1n; s.view.sequence = 1n;
  assert.equal(await new Publisher(s.options).tick(), "waiting");
  assert.equal(s.operations.length, 2);
});

test("active batches continue beyond minute and phases follow chain including repeated safety", async () => {
  const s = setup(); s.now(999n);
  const expected = [[0, 0n, "evaluate"], [0, 1n, "sealEvaluation"], [3, 0n, "safety"],
    [3, 1n, "sealEvaluation"], [3, 0n, "safety"], [1, 0n, "execute"], [1, 1n, "finalize"]] as const;
  for (const [phase, cursor, kind] of expected) {
    s.view.stage = stage(phase, cursor);
    if (s.operations.length === 4) s.view.stage.revision = "second-safety-pass";
    assert.equal(await new Publisher(s.options).tick(), "submitted");
    assert.equal(s.operations.at(-1)?.kind, kind);
  }
  assert.notEqual(s.operations[2].id, s.operations[4].id);
  assert.equal(s.calls.includes("archive"), false);
});

test("pause retains accepted stage; resume schedules same operation", async () => {
  const s = setup(); s.view.stage = stage(1); s.view.paused = true;
  assert.equal(await s.worker.tick(), "paused");
  s.view.paused = false; s.now(2000n);
  assert.equal(await s.worker.tick(), "submitted");
  assert.equal(s.operations[0].kind, "execute");
});

test("missed minute skips history and requests only current cutoff", async () => {
  const s = setup(); s.now(236n);
  assert.equal(await s.worker.tick(), "missed"); assert.equal(s.calls.includes("archive"), false);
  s.now(241n); s.snapshot({ cutoff: 240n, digest: "next", archiveTime: 241n, prices: [] });
  assert.equal(await s.worker.tick(), "submitted"); assert.equal(s.operations[0].batchId, 2n);
});

test("origin must be accepted as batch zero during its actual window", async () => {
  const s = setup(); s.view.initialized = false; s.now(119n);
  assert.equal(await s.worker.tick(), "waiting");
  s.now(175n); s.snapshot({ cutoff: 120n, digest: "origin", archiveTime: 130n, prices: [] });
  assert.equal(await s.worker.tick(), "submitted"); assert.equal(s.operations[0].batchId, 0n);
  s.now(176n);
  assert.equal(await s.worker.tick(), "origin-missed");
  s.now(241n);
  assert.equal(await s.worker.tick(), "origin-missed"); assert.equal(s.operations.length, 1);
});

test("archive wait crossing acceptance deadline never submits stale snapshot", async () => {
  const s = setup();
  s.options.archive.snapshot = async () => { s.now(236n); return { cutoff: 180n, digest: "x", archiveTime: 190n, prices: [] }; };
  assert.equal(await s.worker.tick(), "missed"); assert.equal(s.operations.length, 0);
});

test("refuses inconsistent active batches and wrong methodology origin", async () => {
  const s = setup(); s.view.stage = stage(2);
  await assert.rejects(s.worker.tick(), /InconsistentActiveBatch/);
  s.view.stage = stage(1, 2n);
  await assert.rejects(s.worker.tick(), /InconsistentActiveBatch/);
  s.view.origin = 180n;
  await assert.rejects(s.worker.tick(), /MethodologyOriginMismatch/);
});

test("operation ids include pool, cursor, predecessor and safety revision", () => {
  const op = { kind: "safety" as const, batchId: 2n, sequence: 1n, predecessor: "p", revision: "r", cursor: 0n };
  const base = operationId(identity, op);
  assert.equal(base, operationId(identity, { ...op }));
  for (const changed of [{ ...op, cursor: 1n }, { ...op, revision: "r2" }, { ...op, predecessor: "p2" }])
    assert.notEqual(base, operationId(identity, changed));
  assert.notEqual(base, operationId({ ...identity, pool: "other" }, op));
});

test("unavailable snapshot waits without advancing the chain", async () => {
  const s = setup();
  const options = { ...s.options, archive: { snapshot: async () => null } };
  assert.equal(await new Publisher(options).tick(), "inadmissible");
  assert.equal(s.operations.length, 0);
});

test("outcome journaling reloads transport changes instead of overwriting pending", async () => {
  const s = setup();
  s.options.chain.submit = async () => {
    const state = await s.options.store.load();
    await s.options.store.save({ ...state, pending: { operationId: "operation", kind: "publish", requestId: "request",
      batchId: "1", sequence: "1", revision: "r", unsignedBase64: "AQ==", signedBase64: null,
      signature: null, blockhash: "b", lastValidBlockHeight: 10, expiresAt: 100, keyVersion: "version" } });
  };
  assert.equal(await s.worker.tick(), "submitted");
  assert.equal(s.state().pending?.operationId, "operation");
});
