import { createHash } from "node:crypto";
import { PILOT_ASSETS, type AssetId } from "./catalogue.ts";
export * from "./catalogue.ts";

export const SCALE = 1_000_000_000_000n;
export const PRICE_SCALE = 100_000_000n;
export const DEV_RUNTIME = "GNmM11ZMFqEu3FYewGNDunpSSJBw8KnkDxzCGpSbpGj6";
export interface ManifestConfig {
  version: string;
  assets: readonly AssetId[];
  originUnixSeconds: number | null;
  runtimeAuthority: string;
  bybitEnabled: boolean;
  feedCheckDigest: string | null;
  status: "draft" | "sealed";
}
export const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export function compileManifest(config: ManifestConfig) {
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(config.version)) throw new Error("InvalidVersion");
  if (!["draft", "sealed"].includes(config.status)) throw new Error("InvalidStatus");
  if (typeof config.bybitEnabled !== "boolean") throw new Error("InvalidBybitPolicy");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(config.runtimeAuthority)) throw new Error("InvalidAuthority");
  if (config.originUnixSeconds !== null && (!Number.isSafeInteger(config.originUnixSeconds) || config.originUnixSeconds <= 0 || config.originUnixSeconds % 60 !== 0)) throw new Error("InvalidOrigin");
  if (config.feedCheckDigest !== null && !/^[a-f0-9]{64}$/.test(config.feedCheckDigest)) throw new Error("InvalidFeedCheckDigest");
  if (config.status === "sealed" && (config.originUnixSeconds === null || config.feedCheckDigest === null)) throw new Error("UnsealableManifest");
  if (config.assets.length < 2 || config.assets.length > 30 || new Set(config.assets).size !== config.assets.length) throw new Error("InvalidRoster");
  const selected = PILOT_ASSETS.filter(asset => config.assets.includes(asset.id as AssetId));
  if (selected.length !== config.assets.length || selected.some((asset, index) => asset.id !== config.assets[index])) throw new Error("NonCanonicalRoster");
  const tuple = [
    "COX/METHODOLOGY/V1", config.version, config.status, config.feedCheckDigest,
    selected.map(asset => [asset.id, asset.krakenWs, asset.krakenRest, asset.coinbase, asset.bybit, "1", String(selected.length)]),
    ["USD", "100000000"],
    ["COMMON_ORIGIN_SNAPSHOT", config.originUnixSeconds, "100000000000000"],
    ["UTC_CLOSED_MINUTE", 60, "COX/PRICE-FALLBACK/V1", config.bybitEnabled, ["USDT/USD", "USDTZUSD", "USDT-USD"], "COX/USDT-USD/V1", "HALF_AWAY", 30],
    [60, 30, 55, "SNAPSHOT_ACCEPTANCE_ONLY", "NO_FILL_DEADLINE", 60, "EXECUTION_CAPACITY_TARGET_SECONDS", 3, 60, "REBALANCE_FREEZE"],
    ["solana-devnet", "oracle-operator", config.runtimeAuthority],
    ["COX/TRANSFER/MVP-0", "TEST_COLLATERAL_ONLY", "0"],
    ["1000000000000", "i128-checked", "HALF_AWAY", "u64", "u128", "1000000000000", "FLOOR_USER", "FLOOR_AGGREGATE_CLASS", "POOL_RESIDUAL_NO_DISTRIBUTION"],
    ["COX/ACCOUNTING/V1", "COX/BATCH/ASYNC/V1", "COX/WIRE/V1"],
  ];
  const canonical = JSON.stringify(tuple);
  return { canonical, digest: sha256(canonical), assetCount: selected.length, label: `CRYPTO (pilot, ${selected.length} assets)` };
}
export function round(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("InvalidDenominator");
  const sign = numerator < 0n ? -1n : 1n;
  const n = numerator < 0n ? -numerator : numerator;
  return sign * (n / denominator + (2n * (n % denominator) >= denominator ? 1n : 0n));
}
export function exactUsd(value: string): bigint {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/.exec(value);
  if (!match) throw new Error("InvalidUsdPrecision");
  const result = BigInt(match[1]!) * PRICE_SCALE + BigInt((match[2] ?? "").padEnd(8, "0"));
  if (result <= 0n || result > (1n << 64n) - 1n) throw new Error("InvalidPrice");
  return result;
}
export function bybitUsd(close: string, conversion: string): bigint {
  const decimal = (value: string): [bigint, bigint] => {
    const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
    if (!match) throw new Error("InvalidDecimal");
    return [BigInt(match[1]! + (match[2] ?? "")), 10n ** BigInt((match[2] ?? "").length)];
  };
  const [a, b] = decimal(close);
  const [c, d] = decimal(conversion);
  const numerator = a * c * PRICE_SCALE;
  const denominator = b * d;
  if (numerator >= 1n << 127n || denominator >= 1n << 127n) throw new Error("ArithmeticOverflow");
  const result = round(numerator, denominator);
  if (result <= 0n || result > (1n << 64n) - 1n) throw new Error("InvalidPrice");
  return result;
}
function uint(value: bigint, width: number): Buffer {
  if (value < 0n || value >= 1n << BigInt(width * 8)) throw new Error("IntegerOutOfRange");
  const out = Buffer.alloc(width);
  for (let i = 0; i < width; i++) out[i] = Number(value >> BigInt(8 * i) & 255n);
  return out;
}
const stringBytes = (value: string): Buffer => {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([uint(BigInt(bytes.length), 4), bytes]);
};
export interface Price {
  assetId: AssetId;
  venue: 0 | 1 | 2;
  step: 1 | 2 | 3 | 4;
  candleStart: bigint;
  priceE8: bigint;
  tradeAgeMinutes: number;
}
export function priceBytes(price: Price): Buffer {
  const asset = PILOT_ASSETS.find(asset => asset.id === price.assetId);
  if (!asset || !Number.isInteger(price.tradeAgeMinutes) || price.tradeAgeMinutes < 0 || price.tradeAgeMinutes > 30 || price.priceE8 <= 0n) throw new Error("InvalidPrice");
  if (!((price.venue === 0 && (price.step === 1 || price.step === 4)) || (price.venue === 1 && price.step === 2 && asset.coinbase !== null) || (price.venue === 2 && price.step === 3 && asset.bybit !== null))) throw new Error("InvalidVenueStep");
  if (price.candleStart < 0n || price.candleStart % 60n !== 0n || (price.step !== 4 && price.tradeAgeMinutes !== 0)) throw new Error("InvalidCandle");
  return Buffer.concat([stringBytes("COX/PRICE/V1"), stringBytes(price.assetId), uint(BigInt(price.venue), 1), uint(BigInt(price.step), 1), uint(price.candleStart, 8), uint(price.priceE8, 8), uint(BigInt(price.tradeAgeMinutes), 2)]);
}
export function snapshotBytes(cutoff: bigint, prices: readonly Price[], roster: readonly AssetId[]): Buffer {
  if (cutoff <= 0n || cutoff % 60n !== 0n || prices.length !== roster.length || roster.length < 2 || new Set(roster).size !== roster.length) throw new Error("InvalidSnapshot");
  const canonical = PILOT_ASSETS.filter(asset => roster.includes(asset.id as AssetId));
  if (canonical.length !== roster.length || canonical.some((asset, i) => asset.id !== roster[i])) throw new Error("NonCanonicalRoster");
  const digests = prices.map((price, index) => {
    if (price.assetId !== roster[index] || price.candleStart !== cutoff - 60n - BigInt(price.tradeAgeMinutes) * 60n) throw new Error("InvalidSnapshotOrderOrTime");
    return Buffer.from(sha256(priceBytes(price)), "hex");
  });
  return Buffer.concat([stringBytes("COX/SNAPSHOT/V1"), uint(cutoff, 8), uint(BigInt(prices.length), 4), ...digests]);
}
