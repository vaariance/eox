import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MonitorMathError } from "../src/arithmetic.js";
import { type PublicationState, type WireReceipt, NO_PREDECESSOR, encodeReceipt, encodeState, receiptRoot, receiptRoots, stateDigest } from "../src/state.js";

interface RawReceipt {
  request: string;
  status: number;
  minted: string;
  proceeds: string;
  bytes: string;
}

interface RawState {
  program: string;
  pool: string;
  sequence: string;
  batch: string;
  cutoff: string;
  previousState: string;
  manifest: string;
  snapshot: string;
  benchmark: string;
  prices: string[];
  references: string[];
  classes: { preBacking: string; preUnits: string; postBacking: string; postUnits: string }[];
  executed: number;
  rejected: number;
  active: string;
  pending: string;
  payable: string;
  residual: string;
  receiptRoot: string;
}

const vectors = JSON.parse(readFileSync(new URL("../../../packages/cox/fixtures/state-vectors.json", import.meta.url), "utf8")) as {
  version: string;
  emptyReceiptRoot: string;
  receipts: RawReceipt[];
  receiptPrefixRoots: string[];
  state: RawState;
  stateBytes: string;
  stateDigest: string;
};

const receipts: WireReceipt[] = vectors.receipts.map((raw) => ({ request: raw.request, status: raw.status, minted: BigInt(raw.minted), proceeds: BigInt(raw.proceeds) }));

const raw = vectors.state;
const state: PublicationState = {
  ...raw,
  sequence: BigInt(raw.sequence),
  batch: BigInt(raw.batch),
  cutoff: BigInt(raw.cutoff),
  benchmark: BigInt(raw.benchmark),
  prices: raw.prices.map(BigInt),
  references: raw.references.map(BigInt),
  classes: raw.classes.map((item) => ({ preBacking: BigInt(item.preBacking), preUnits: BigInt(item.preUnits), postBacking: BigInt(item.postBacking), postUnits: BigInt(item.postUnits) })),
  active: BigInt(raw.active),
  pending: BigInt(raw.pending),
  payable: BigInt(raw.payable),
  residual: BigInt(raw.residual),
};

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof MonitorMathError) return error.code;
    throw error;
  }
  return "no error";
}

describe("published state vectors", () => {
  it("is the wire version this monitor was written against", () => {
    expect(vectors.version).toBe("COX/WIRE/V1");
  });

  it("starts the receipt root from the published empty root", () => {
    expect(receiptRoot([])).toBe(vectors.emptyReceiptRoot);
  });

  it.each(vectors.receipts.map((item, index) => ({ index, bytes: item.bytes })))("encodes receipt $index byte for byte", ({ index, bytes }) => {
    expect(encodeReceipt(receipts[index]!).toString("hex")).toBe(bytes);
  });

  it("folds the receipts into every published prefix root", () => {
    expect(receiptRoots(receipts).slice(1)).toEqual(vectors.receiptPrefixRoots);
    expect(receiptRoot(receipts)).toBe(vectors.state.receiptRoot);
  });

  it("encodes the publication state byte for byte and matches its digest", () => {
    expect(encodeState(state).toString("hex")).toBe(vectors.stateBytes);
    expect(stateDigest(state)).toBe(vectors.stateDigest);
  });
});

describe("state and receipt rules", () => {
  it("gives a different root when receipts are reordered", () => {
    expect(receiptRoot([receipts[1]!, receipts[0]!, receipts[2]!])).not.toBe(receiptRoot(receipts));
  });

  it("changes the digest when any committed total changes", () => {
    expect(stateDigest({ ...state, residual: state.residual + 1n })).not.toBe(vectors.stateDigest);
    expect(stateDigest({ ...state, previousState: NO_PREDECESSOR })).not.toBe(vectors.stateDigest);
  });

  it("encodes a negative reference as two's complement and refuses one outside i128", () => {
    const bytes = encodeState({ ...state, references: [-1n] });
    expect(bytes.includes(Buffer.alloc(16, 0xff))).toBe(true);
    expect(code(() => encodeState({ ...state, references: [1n << 127n] }))).toBe("IntegerOutOfRange");
  });

  it("refuses an unknown receipt status, a short digest and an amount that does not fit", () => {
    expect(code(() => encodeReceipt({ ...receipts[0]!, status: 5 }))).toBe("InvalidReceiptStatus");
    expect(code(() => encodeReceipt({ ...receipts[0]!, request: "01" }))).toBe("InvalidBytes32");
    expect(code(() => encodeReceipt({ ...receipts[0]!, proceeds: 1n << 64n }))).toBe("IntegerOutOfRange");
    expect(code(() => encodeState({ ...state, snapshot: "zz".repeat(32) }))).toBe("InvalidBytes32");
  });
});
