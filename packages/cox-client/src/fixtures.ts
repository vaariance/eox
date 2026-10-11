import { writeFileSync } from "node:fs";
import { feePolicyDigest, receiptBytes, receiptRoot, stateBytes, stateDigest, type Receipt, type State } from "./wire.ts";

const key = (value: number) => Buffer.alloc(32, value);
const receipts: Receipt[] = [
  { request: key(1), status: 0, minted: 33333333333333n, proceeds: 0n },
  { request: key(2), status: 0, minted: 0n, proceeds: 12n },
  { request: key(3), status: 4, minted: 0n, proceeds: 0n }
];
const state: State = {
  program: key(11), pool: key(12), sequence: 2n, batch: 7n, cutoff: 1800000420n,
  previousState: key(13), manifest: key(14), snapshot: key(15), benchmark: 101000000000000n,
  prices: [6000000000000n, 300000000000n], references: [102000000000000n, 98000000000000n, 100000000000000n],
  classes: [
    { preBacking: 90n, preUnits: 100000000000000n, postBacking: 119n, postUnits: 133333333333333n },
    { preBacking: 60n, preUnits: 100000000000000n, postBacking: 48n, postUnits: 80000000000000n },
    { preBacking: 0n, preUnits: 0n, postBacking: 0n, postUnits: 0n }
  ],
  executed: 2, rejected: 1, active: 167n, pending: 5n, payable: 12n, residual: 1n, receiptRoot: receiptRoot(receipts)
};
const decimal = (_: string, value: unknown) => typeof value === "bigint" ? value.toString() : value instanceof Uint8Array ? Buffer.from(value).toString("hex") : value;
const jsonState = { ...state, program: Buffer.from(state.program).toString("hex"), pool: Buffer.from(state.pool).toString("hex"), previousState: Buffer.from(state.previousState).toString("hex"), manifest: Buffer.from(state.manifest).toString("hex"), snapshot: Buffer.from(state.snapshot).toString("hex"), receiptRoot: Buffer.from(state.receiptRoot).toString("hex") };
const output = {
  version: "COX/WIRE/V1", purpose: "Synthetic encoding vectors; not a deployed pool or economic reference calculation",
  emptyReceiptRoot: receiptRoot([]).toString("hex"),
  receipts: receipts.map(receipt => ({ ...receipt, request: Buffer.from(receipt.request).toString("hex"), bytes: receiptBytes(receipt).toString("hex") })),
  receiptPrefixRoots: receipts.map((_, index) => receiptRoot(receipts.slice(0, index + 1)).toString("hex")),
  state: jsonState, stateBytes: stateBytes(state).toString("hex"), stateDigest: stateDigest(state).toString("hex")
};
writeFileSync(new URL("../../cox/fixtures/state-vectors.json", import.meta.url), `${JSON.stringify(output, decimal, 2)}\n`);

const feeReceipts: Receipt[] = [
  { request: key(1), status: 0, minted: 999800000000000000n, proceeds: 0n, feeTerms: { gross: 1000000n, fee: 200n, feeVersion: 1n, feeBps: 2, feeCap: 2000000n } },
  { request: key(2), status: 0, minted: 0n, proceeds: 99998000000n, feeTerms: { gross: 100000000000n, fee: 2000000n, feeVersion: 2n, feeBps: 3, feeCap: 2000000n } },
  { request: key(3), status: 4, minted: 0n, proceeds: 0n, feeTerms: { gross: 0n, fee: 0n, feeVersion: 1n, feeBps: 2, feeCap: 2000000n } },
];
const feeState: State = { ...state, previousState: stateDigest(state), receiptRoot: receiptRoot(feeReceipts),
  feeState: { fees: 2000200n, batchFees: 2000200n, feeVersion: 2n, feeBps: 3, feeCap: 2000000n, feeNextVersion: 4n,
    feePending: true, feePendingVersion: 3n, feePendingBps: 4, feePendingCap: 1000000n, feePendingCutoff: 1800086820n,
    feeInitialScheduled: true, feePolicyDigest: feePolicyDigest(state.manifest) } };
const feeOutput = {
  version: "COX/WIRE/V2", purpose: "Synthetic encoding vectors; not a deployed pool or economic reference calculation",
  emptyReceiptRoot: receiptRoot([], 2).toString("hex"),
  receipts: feeReceipts.map(receipt => ({ ...receipt, request: Buffer.from(receipt.request).toString("hex"), bytes: receiptBytes(receipt).toString("hex") })),
  receiptPrefixRoots: feeReceipts.map((_, index) => receiptRoot(feeReceipts.slice(0, index + 1)).toString("hex")),
  state: { ...jsonState, previousState: Buffer.from(feeState.previousState).toString("hex"), receiptRoot: Buffer.from(feeState.receiptRoot).toString("hex"), feeState: { ...feeState.feeState, feePolicyDigest: Buffer.from(feeState.feeState!.feePolicyDigest).toString("hex") } },
  stateBytes: stateBytes(feeState).toString("hex"), stateDigest: stateDigest(feeState).toString("hex")
};
writeFileSync(new URL("../../cox/fixtures/fee-state-vectors.json", import.meta.url), `${JSON.stringify(feeOutput, decimal, 2)}\n`);
