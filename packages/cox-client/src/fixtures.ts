import { writeFileSync } from "node:fs";
import { receiptBytes, receiptRoot, stateBytes, stateDigest, type Receipt, type State } from "./wire.ts";

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
