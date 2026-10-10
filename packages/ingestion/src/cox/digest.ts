import { createHash } from "node:crypto";

export const PRICE_DOMAIN = "COX/PRICE/V1";
export const SNAPSHOT_DOMAIN = "COX/SNAPSHOT/V1";
export const VENUE_CODES = { kraken: 0, coinbase: 1, bybit: 2 } as const;
const STEP_VENUE: Record<number, keyof typeof VENUE_CODES> = { 1: "kraken", 2: "coinbase", 3: "bybit", 4: "kraken" };
const U64_MAX = (1n << 64n) - 1n;
const MAX_TRADE_AGE = 30;

export interface DigestedPrice {
  assetId: string;
  venue: keyof typeof VENUE_CODES;
  step: number;
  candleStart: number;
  priceE8: string;
  tradeAgeMinutes: number;
}

function uint(value: bigint, width: number): Buffer {
  if (value < 0n || value >= 1n << BigInt(width * 8)) throw new Error("IntegerOutOfRange");
  const out = Buffer.alloc(width);
  for (let i = 0; i < width; i += 1) out[i] = Number((value >> BigInt(8 * i)) & 255n);
  return out;
}

function str(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([uint(BigInt(bytes.length), 4), bytes]);
}

export function priceBytes(price: DigestedPrice): Buffer {
  const priceE8 = BigInt(price.priceE8);
  if (priceE8 <= 0n || priceE8 > U64_MAX) throw new Error("InvalidPrice");
  if (STEP_VENUE[price.step] !== price.venue) throw new Error("InvalidVenueStep");
  if (!Number.isInteger(price.tradeAgeMinutes) || price.tradeAgeMinutes < 0 || price.tradeAgeMinutes > MAX_TRADE_AGE) throw new Error("InvalidPrice");
  if (price.candleStart % 60 !== 0 || (price.step !== 4 && price.tradeAgeMinutes !== 0)) throw new Error("InvalidCandle");
  return Buffer.concat([
    str(PRICE_DOMAIN),
    str(price.assetId),
    uint(BigInt(VENUE_CODES[price.venue]), 1),
    uint(BigInt(price.step), 1),
    uint(BigInt(price.candleStart), 8),
    uint(priceE8, 8),
    uint(BigInt(price.tradeAgeMinutes), 2),
  ]);
}

export function priceDigest(price: DigestedPrice): Buffer {
  return createHash("sha256").update(priceBytes(price)).digest();
}

export function snapshotBytes(cutoff: number, prices: readonly DigestedPrice[]): Buffer {
  if (cutoff <= 0 || cutoff % 60 !== 0 || prices.length < 2) throw new Error("InvalidSnapshot");
  const digests = prices.map((price) => {
    if (price.candleStart !== cutoff - 60 - price.tradeAgeMinutes * 60) throw new Error("InvalidSnapshotOrderOrTime");
    return priceDigest(price);
  });
  return Buffer.concat([str(SNAPSHOT_DOMAIN), uint(BigInt(cutoff), 8), uint(BigInt(prices.length), 4), ...digests]);
}

export function snapshotDigest(cutoff: number, prices: readonly DigestedPrice[]): string {
  return createHash("sha256").update(snapshotBytes(cutoff, prices)).digest("hex");
}
