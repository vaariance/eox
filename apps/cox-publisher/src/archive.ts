import { bybitUsd, exactUsd, PILOT_ASSETS, sha256, snapshotBytes, type AssetId, type Price } from "@cox/methodology";
import type { Archive, MethodologyPolicy, Snapshot } from "./types.ts";

export interface HttpArchiveOptions { fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number }
const digestPattern = /^[a-f0-9]{64}$/;
const decimalPattern = /^(0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
function fail(detail: string): never { throw new Error(`InvalidArchive: ${detail}`); }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("expected object");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) fail("expected array"); return value; }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value)) fail("expected safe integer"); return value; }
function decimal(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !decimalPattern.test(value) || !/[1-9]/.test(value)) fail("expected positive decimal");
  return value;
}
function digest(value: unknown): string { if (typeof value !== "string" || !digestPattern.test(value)) fail("expected digest"); return value; }
function attempts(value: unknown): Record<string, unknown>[] {
  const result = array(value).map(object);
  if (result.length > 4) fail("too many fallback attempts");
  result.forEach((attempt, index) => {
    if (integer(attempt.step) !== index + 1 || attempt.venue !== ["kraken", "coinbase", "bybit", "kraken"][index]) fail("fallback order");
    if (!["trades", "empty", "not-listed", "unavailable", "malformed", "rate-limited"].includes(String(attempt.outcome))) fail("fallback outcome");
    if (attempt.artifactDigest !== null) digest(attempt.artifactDigest);
    if (index < result.length - 1 && attempt.outcome === "trades") fail("fallback continued after trades");
  });
  return result;
}

export class HttpArchive implements Archive {
  private readonly base: URL;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  constructor(baseUrl: string, options: HttpArchiveOptions = {}) {
    this.base = new URL(baseUrl);
    if (!["http:", "https:"].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash) throw new Error("InvalidArchiveUrl");
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxBytes = options.maxBytes ?? 8_388_608;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || !Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0) throw new Error("InvalidArchiveLimits");
  }
  private async get(path: string, missing: boolean): Promise<Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(new URL(path, this.base), { signal: controller.signal, redirect: "error", headers: { accept: path.includes("artifacts") ? "application/octet-stream" : "application/json" } });
      if (response.status === 404 && missing) return null;
      if (!response.ok) throw new Error(`ArchiveHttpError: ${response.status}`);
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^[0-9]+$/.test(declared) || Number(declared) > this.maxBytes)) fail("response too large");
      const reader = response.body?.getReader();
      if (!reader) fail("empty response");
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > this.maxBytes) { await reader.cancel(); fail("response too large"); }
        chunks.push(chunk.value);
      }
      return Buffer.concat(chunks);
    } finally { clearTimeout(timer); }
  }
  async snapshot(cutoff: bigint, policy: MethodologyPolicy): Promise<Snapshot | null> {
    if (cutoff <= 0n || cutoff % 60n !== 0n || cutoff < policy.origin) fail("cutoff");
    const raw = await this.get(`/v1/prices/cutoffs/${cutoff}`, true);
    if (raw === null) return null;
    const view = object(JSON.parse(raw.toString("utf8")) as unknown);
    if (view.schema !== "cox.evidence/v1" || view.rule !== "COX/PRICE-FALLBACK/V1" || view.priceScale !== "100000000" || BigInt(integer(view.cutoff)) !== cutoff) fail("schema, rule, scale or cutoff");
    const snapshot = object(view.snapshot);
    if (typeof snapshot.admissible !== "boolean") fail("snapshot admission");
    if (!snapshot.admissible) return null;
    if (snapshot.digestEncoding !== "COX/WIRE/V1") fail("snapshot encoding");
    const hash = digest(snapshot.digest);
    const recordedMs = BigInt(integer(snapshot.recordedAtMs));
    if (recordedMs < cutoff * 1000n || recordedMs > (cutoff + 30n) * 1000n) fail("archive deadline");
    const entries = array(view.assets);
    if (entries.length !== policy.assets.length) fail("sealed roster differs from archive roster");
    const artifacts = new Set<string>();
    const prices: Price[] = entries.map((value, index) => {
      const entry = object(value);
      const assetId = policy.assets[index]!;
      const catalogue = PILOT_ASSETS.find(asset => asset.id === assetId);
      if (!catalogue || entry.assetId !== assetId || integer(entry.position) !== PILOT_ASSETS.findIndex(asset => asset.id === assetId)) fail("asset order or position");
      const history = attempts(entry.attempts);
      const price = object(entry.price);
      if (price.admissible !== true || price.rejection !== null) fail("inadmissible price");
      const venue = ["kraken", "coinbase", "bybit"].indexOf(String(price.venue));
      if (venue < 0 || venue > 2) fail("venue");
      const step = integer(price.step);
      if (step < 1 || step > 4 || history.length !== step) fail("step");
      const chosenDigest = digest(price.artifactDigest);
      const chosen = history[step - 1]!;
      if (chosen.outcome !== "trades" || chosen.venue !== price.venue || chosen.artifactDigest !== chosenDigest) fail("selected evidence");
      artifacts.add(chosenDigest);
      decimal(price.tradeEvidence);
      const close = decimal(price.close);
      let converted: bigint;
      if (venue === 2) {
        if (!policy.bybit) fail("Bybit disabled");
        converted = bybitUsd(close, decimal(price.usdtUsd));
        const conversionDigest = digest(price.usdtArtifactDigest);
        const conversions = attempts(object(view.usdtUsd).attempts);
        if (!conversions.some(attempt => attempt.outcome === "trades" && attempt.artifactDigest === conversionDigest && (attempt.venue === "kraken" || attempt.venue === "coinbase"))) fail("conversion evidence");
        artifacts.add(conversionDigest);
      } else {
        if (price.usdtUsd !== null || price.usdtArtifactDigest !== null) fail("unexpected conversion");
        converted = exactUsd(close);
      }
      if (typeof price.priceE8 !== "string" || !/^[1-9][0-9]{0,19}$/.test(price.priceE8) || BigInt(price.priceE8) !== converted) fail("price conversion");
      return { assetId: assetId as AssetId, venue: venue as 0 | 1 | 2, step: step as 1 | 2 | 3 | 4, priceE8: converted, candleStart: BigInt(integer(price.candleStart)), tradeAgeMinutes: integer(price.tradeAgeMinutes) };
    });
    if (sha256(snapshotBytes(cutoff, prices, policy.assets)) !== hash) fail("snapshot fingerprint");
    const selectedArtifacts = [...artifacts];
    for (let start = 0; start < selectedArtifacts.length; start += 4) {
      await Promise.all(selectedArtifacts.slice(start, start + 4).map(async artifact => {
        const bytes = await this.get(`/v1/artifacts/${artifact}`, false);
        if (bytes === null || sha256(bytes) !== artifact) fail("artifact fingerprint");
      }));
    }
    return { cutoff, digest: hash, archiveTime: recordedMs / 1000n, prices: prices.map(({ assetId: _, ...price }) => price) };
  }
}
