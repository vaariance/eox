import { createHash } from "node:crypto";

export const PRICE_DOMAIN = "COX/PRICE/V1";
export const SNAPSHOT_DOMAIN = "COX/SNAPSHOT/V1";
export const VENUE_CODES = { kraken: 0, coinbase: 1, bybit: 2 } as const;

export interface DigestedPrice {
  assetId: string;
  venue: keyof typeof VENUE_CODES;
  step: number;
  candleStart: number;
  priceE8: string | null;
  tradeAgeMinutes: number;
}

function i64(value: bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(value);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

export function priceDigest(price: DigestedPrice): Buffer {
  const asset = Buffer.from(price.assetId, "ascii");
  if (asset.length < 1 || asset.length > 255) throw new Error("asset id must be 1 to 255 bytes");
  return createHash("sha256")
    .update(Buffer.from(PRICE_DOMAIN, "ascii"))
    .update(Buffer.from([asset.length]))
    .update(asset)
    .update(Buffer.from([VENUE_CODES[price.venue], price.step]))
    .update(i64(BigInt(price.candleStart)))
    .update(Buffer.from([price.priceE8 === null ? 0 : 1]))
    .update(i64(price.priceE8 === null ? 0n : BigInt(price.priceE8)))
    .update(u32(price.tradeAgeMinutes))
    .digest();
}

export function snapshotDigest(cutoff: number, prices: readonly DigestedPrice[]): string {
  const hash = createHash("sha256").update(Buffer.from(SNAPSHOT_DOMAIN, "ascii")).update(i64(BigInt(cutoff))).update(u32(prices.length));
  for (const price of prices) hash.update(priceDigest(price));
  return hash.digest("hex");
}
