import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { decodeState, integer, receiptBytes, receiptRoot, stateBytes, stateDigest, type Receipt, type State } from "../src/wire.ts";

const vectors = JSON.parse(readFileSync(new URL("../../cox/fixtures/state-vectors.json", import.meta.url), "utf8"));
const receipts: Receipt[] = vectors.receipts.map((value: any) => ({ request: Buffer.from(value.request, "hex"), status: value.status, minted: BigInt(value.minted), proceeds: BigInt(value.proceeds) }));
const state: State = {
  ...vectors.state,
  ...Object.fromEntries(["program", "pool", "previousState", "manifest", "snapshot", "receiptRoot"].map(key => [key, Buffer.from(vectors.state[key], "hex")])),
  ...Object.fromEntries(["sequence", "batch", "cutoff", "benchmark", "active", "pending", "payable", "residual"].map(key => [key, BigInt(vectors.state[key])])),
  prices: vectors.state.prices.map(BigInt), references: vectors.state.references.map(BigInt),
  classes: vectors.state.classes.map((value: any) => Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, BigInt(amount as string)])))
};
test("receipt bytes and ordered roots match checked vectors", () => {
  assert.equal(receiptRoot([]).toString("hex"), vectors.emptyReceiptRoot);
  for (let i = 0; i < receipts.length; i++) {
    assert.equal(receiptBytes(receipts[i]!).toString("hex"), vectors.receipts[i].bytes);
    assert.equal(receiptRoot(receipts.slice(0, i + 1)).toString("hex"), vectors.receiptPrefixRoots[i]);
  }
  assert.notDeepEqual(receiptRoot([...receipts].reverse()), receiptRoot(receipts));
});
test("state bytes and digest match checked vector", () => {
  assert.equal(stateBytes(state).toString("hex"), vectors.stateBytes);
  assert.equal(stateDigest(state).toString("hex"), vectors.stateDigest);
  assert.deepEqual(decodeState(stateBytes(state)), state);
  assert.throws(() => decodeState(stateBytes(state).subarray(0, 100)), /TruncatedState/);
  assert.throws(() => decodeState(Buffer.concat([stateBytes(state), Buffer.from([0])])), /TrailingStateBytes/);
  assert.notDeepEqual(stateDigest({ ...state, batch: state.batch + 1n }), stateDigest(state));
  assert.notDeepEqual(stateDigest({ ...state, pending: state.pending + 1n }), stateDigest(state));
});
test("wire integer ranges reject overflow and preserve signed extrema", () => {
  assert.equal(integer(-1n, 16, true).toString("hex"), "ff".repeat(16));
  assert.throws(() => integer(-1n, 8), /IntegerOutOfRange/);
  assert.throws(() => integer(1n << 64n, 8), /IntegerOutOfRange/);
  assert.throws(() => integer(1n << 127n, 16, true), /IntegerOutOfRange/);
  assert.equal(integer(-(1n << 127n), 16, true).toString("hex"), `${"00".repeat(15)}80`);
});
