import { createHash } from "node:crypto";

export const sha256 = (bytes: Uint8Array): Buffer => createHash("sha256").update(bytes).digest();
export function integer(value: bigint, width: number, signed = false): Buffer {
  const bits = BigInt(width * 8);
  const bound = 1n << (signed ? bits - 1n : bits);
  if (value < (signed ? -bound : 0n) || value >= bound) throw new Error("IntegerOutOfRange");
  const out = Buffer.alloc(width);
  const encoded = value < 0n ? value + (1n << bits) : value;
  for (let i = 0; i < width; i++) out[i] = Number(encoded >> BigInt(i * 8) & 255n);
  return out;
}
export function bytes32(value: Uint8Array): Buffer {
  if (value.length !== 32) throw new Error("InvalidBytes32");
  return Buffer.from(value);
}
export function stringBytes(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([integer(BigInt(bytes.length), 4), bytes]);
}
export const discriminator = (kind: "global" | "account" | "event", name: string): Buffer => sha256(Buffer.from(`${kind}:${name}`, "utf8")).subarray(0, 8);
export const ReceiptStatus = Object.freeze({ Filled: 0, ConditionFailed: 1, Expired: 2, ZeroValueClass: 3, SafetyRejected: 4 });
export interface Receipt { request: Uint8Array; status: 0 | 1 | 2 | 3 | 4; minted: bigint; proceeds: bigint }
export function receiptBytes(receipt: Receipt): Buffer {
  if (!Number.isInteger(receipt.status) || receipt.status < 0 || receipt.status > 4) throw new Error("InvalidReceiptStatus");
  return Buffer.concat([bytes32(receipt.request), integer(BigInt(receipt.status), 1), integer(receipt.minted, 16), integer(receipt.proceeds, 8)]);
}
export function receiptRoot(receipts: readonly Receipt[]): Buffer {
  return receipts.reduce((previous, receipt) => sha256(Buffer.concat([previous, receiptBytes(receipt)])), sha256(stringBytes("COX/RECEIPTS/V1")));
}
export interface StateClass { preBacking: bigint; preUnits: bigint; postBacking: bigint; postUnits: bigint }
export interface State {
  program: Uint8Array; pool: Uint8Array; sequence: bigint; batch: bigint; cutoff: bigint;
  previousState: Uint8Array; manifest: Uint8Array; snapshot: Uint8Array; benchmark: bigint;
  prices: readonly bigint[]; references: readonly bigint[]; classes: readonly StateClass[];
  executed: number; rejected: number; active: bigint; pending: bigint; payable: bigint; residual: bigint; receiptRoot: Uint8Array;
}
const vector = <T>(values: readonly T[], encode: (value: T) => Uint8Array): Buffer => Buffer.concat([integer(BigInt(values.length), 4), ...values.map(value => Buffer.from(encode(value)))]);
export function stateBytes(state: State): Buffer {
  if (![state.executed, state.rejected].every(value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff)) throw new Error("InvalidReceiptCount");
  return Buffer.concat([
    stringBytes("COX/STATE/V1"), bytes32(state.program), bytes32(state.pool), integer(state.sequence, 8), integer(state.batch, 8), integer(state.cutoff, 8),
    bytes32(state.previousState), bytes32(state.manifest), bytes32(state.snapshot), integer(state.benchmark, 16, true),
    vector(state.prices, value => integer(value, 8)), vector(state.references, value => integer(value, 16, true)),
    vector(state.classes, value => Buffer.concat([integer(value.preBacking, 8), integer(value.preUnits, 16), integer(value.postBacking, 8), integer(value.postUnits, 16)])),
    integer(BigInt(state.executed), 4), integer(BigInt(state.rejected), 4), integer(state.active, 8), integer(state.pending, 8), integer(state.payable, 8), integer(state.residual, 8), bytes32(state.receiptRoot)
  ]);
}
export const stateDigest = (state: State): Buffer => sha256(stateBytes(state));
export function decodeState(bytes: Uint8Array): State {
  const input = Buffer.from(bytes);
  let offset = 0;
  const take = (length: number): Buffer => {
    if (offset + length > input.length) throw new Error("TruncatedState");
    const value = input.subarray(offset, offset + length); offset += length; return value;
  };
  const number = (width: number, signed = false): bigint => {
    const value = take(width);
    let result = 0n;
    for (let i = width - 1; i >= 0; i--) result = result * 256n + BigInt(value[i]!);
    return signed && (value[width - 1]! & 128) !== 0 ? result - (1n << BigInt(width * 8)) : result;
  };
  const list = <T>(read: () => T): T[] => {
    const count = Number(number(4));
    if (count > 31) throw new Error("StateVectorLimit");
    return Array.from({ length: count }, read);
  };
  const domainLength = Number(number(4));
  if (domainLength !== 12 || take(domainLength).toString("utf8") !== "COX/STATE/V1") throw new Error("InvalidStateDomain");
  const state: State = {
    program: take(32), pool: take(32), sequence: number(8), batch: number(8), cutoff: number(8), previousState: take(32), manifest: take(32), snapshot: take(32), benchmark: number(16, true),
    prices: list(() => number(8)), references: list(() => number(16, true)),
    classes: list(() => ({ preBacking: number(8), preUnits: number(16), postBacking: number(8), postUnits: number(16) })),
    executed: Number(number(4)), rejected: Number(number(4)), active: number(8), pending: number(8), payable: number(8), residual: number(8), receiptRoot: take(32)
  };
  if (offset !== input.length) throw new Error("TrailingStateBytes");
  return state;
}
