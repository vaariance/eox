import { createHash } from "node:crypto";
import { fail } from "./arithmetic.js";

export const VENUE_CODES = { kraken: 0, coinbase: 1, bybit: 2 } as const;
export const MAX_TRADE_AGE_MINUTES = 30;

export interface WirePrice {
  assetId: string;
  venue: number;
  step: number;
  candleStart: bigint;
  priceE8: bigint;
  tradeAgeMinutes: number;
}

const U64_MAX = (1n << 64n) - 1n;
const VENUE_FOR_STEP: Record<number, number> = { 1: VENUE_CODES.kraken, 2: VENUE_CODES.coinbase, 3: VENUE_CODES.bybit, 4: VENUE_CODES.kraken };

function unsigned(value: bigint, bytes: number): Buffer {
  if (value < 0n || value >= 1n << BigInt(bytes * 8)) fail("IntegerOutOfRange");
  const out = Buffer.alloc(bytes);
  let rest = value;
  for (let index = 0; index < bytes; index += 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function text(value: string): Buffer {
  const encoded = Buffer.from(value, "utf8");
  return Buffer.concat([unsigned(BigInt(encoded.length), 4), encoded]);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function encodePrice(price: WirePrice): Buffer {
  if (!/^[A-Z0-9]{1,12}$/.test(price.assetId)) fail("InvalidPrice");
  if (price.priceE8 <= 0n || price.priceE8 > U64_MAX) fail("InvalidPrice");
  if (!Number.isInteger(price.tradeAgeMinutes) || price.tradeAgeMinutes < 0 || price.tradeAgeMinutes > MAX_TRADE_AGE_MINUTES) fail("InvalidPrice");
  if (VENUE_FOR_STEP[price.step] !== price.venue) fail("InvalidVenueStep");
  if (price.candleStart < 0n || price.candleStart % 60n !== 0n) fail("InvalidCandle");
  if (price.step !== 4 && price.tradeAgeMinutes !== 0) fail("InvalidCandle");
  return Buffer.concat([
    text("COX/PRICE/V1"),
    text(price.assetId),
    unsigned(BigInt(price.venue), 1),
    unsigned(BigInt(price.step), 1),
    unsigned(price.candleStart, 8),
    unsigned(price.priceE8, 8),
    unsigned(BigInt(price.tradeAgeMinutes), 2),
  ]);
}

export function priceDigest(price: WirePrice): string {
  return sha256Hex(encodePrice(price));
}

export function encodeSnapshot(cutoff: bigint, roster: readonly string[], prices: readonly WirePrice[]): Buffer {
  if (cutoff <= 0n || cutoff % 60n !== 0n) fail("InvalidSnapshot");
  if (roster.length < 2 || prices.length !== roster.length || new Set(roster).size !== roster.length) fail("InvalidSnapshot");
  const digests = prices.map((price, index) => {
    if (price.assetId !== roster[index]) fail("InvalidSnapshotOrderOrTime");
    if (price.candleStart !== cutoff - 60n - BigInt(price.tradeAgeMinutes) * 60n) fail("InvalidSnapshotOrderOrTime");
    return Buffer.from(priceDigest(price), "hex");
  });
  return Buffer.concat([text("COX/SNAPSHOT/V1"), unsigned(cutoff, 8), unsigned(BigInt(prices.length), 4), ...digests]);
}

export function snapshotDigest(cutoff: bigint, roster: readonly string[], prices: readonly WirePrice[]): string {
  return sha256Hex(encodeSnapshot(cutoff, roster, prices));
}
