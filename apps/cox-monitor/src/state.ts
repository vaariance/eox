import { fail } from "./arithmetic.js";
import { sha256Hex, text, unsigned } from "./wire.js";

export const RECEIPT_STATUS = { filled: 0, conditionFailed: 1, expired: 2, zeroValueClass: 3, safetyRejected: 4 } as const;

export interface WireReceipt {
  request: string;
  status: number;
  minted: bigint;
  proceeds: bigint;
}

export interface StateClass {
  preBacking: bigint;
  preUnits: bigint;
  postBacking: bigint;
  postUnits: bigint;
}

export interface PublicationState {
  program: string;
  pool: string;
  sequence: bigint;
  batch: bigint;
  cutoff: bigint;
  previousState: string;
  manifest: string;
  snapshot: string;
  benchmark: bigint;
  prices: readonly bigint[];
  references: readonly bigint[];
  classes: readonly StateClass[];
  executed: number;
  rejected: number;
  active: bigint;
  pending: bigint;
  payable: bigint;
  residual: bigint;
  receiptRoot: string;
}

export const NO_PREDECESSOR = "00".repeat(32);

const MAX_STATUS = RECEIPT_STATUS.safetyRejected;

function digest32(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(hex)) fail("InvalidBytes32");
  return Buffer.from(hex, "hex");
}

function signed128(value: bigint): Buffer {
  const limit = 1n << 127n;
  if (value < -limit || value >= limit) fail("IntegerOutOfRange");
  return unsigned(value < 0n ? value + (1n << 128n) : value, 16);
}

function count(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0) fail("IntegerOutOfRange");
  return unsigned(BigInt(value), 4);
}

function list<T>(items: readonly T[], encode: (item: T) => Buffer): Buffer {
  return Buffer.concat([count(items.length), ...items.map(encode)]);
}

export function encodeReceipt(receipt: WireReceipt): Buffer {
  if (!Number.isInteger(receipt.status) || receipt.status < 0 || receipt.status > MAX_STATUS) fail("InvalidReceiptStatus");
  return Buffer.concat([digest32(receipt.request), unsigned(BigInt(receipt.status), 1), unsigned(receipt.minted, 16), unsigned(receipt.proceeds, 8)]);
}

export function receiptRoots(receipts: readonly WireReceipt[]): string[] {
  const roots = [sha256Hex(text("COX/RECEIPTS/V1"))];
  for (const receipt of receipts) {
    roots.push(sha256Hex(Buffer.concat([Buffer.from(roots[roots.length - 1]!, "hex"), encodeReceipt(receipt)])));
  }
  return roots;
}

export function receiptRoot(receipts: readonly WireReceipt[]): string {
  const roots = receiptRoots(receipts);
  return roots[roots.length - 1]!;
}

export function encodeState(state: PublicationState): Buffer {
  return Buffer.concat([
    text("COX/STATE/V1"),
    digest32(state.program),
    digest32(state.pool),
    unsigned(state.sequence, 8),
    unsigned(state.batch, 8),
    unsigned(state.cutoff, 8),
    digest32(state.previousState),
    digest32(state.manifest),
    digest32(state.snapshot),
    signed128(state.benchmark),
    list(state.prices, (price) => unsigned(price, 8)),
    list(state.references, signed128),
    list(state.classes, (item) => Buffer.concat([unsigned(item.preBacking, 8), unsigned(item.preUnits, 16), unsigned(item.postBacking, 8), unsigned(item.postUnits, 16)])),
    count(state.executed),
    count(state.rejected),
    unsigned(state.active, 8),
    unsigned(state.pending, 8),
    unsigned(state.payable, 8),
    unsigned(state.residual, 8),
    digest32(state.receiptRoot),
  ]);
}

export function stateDigest(state: PublicationState): string {
  return sha256Hex(encodeState(state));
}
