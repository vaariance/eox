import { MonitorMathError } from "./arithmetic.js";
import { usdToE8, usdtToE8 } from "./decimal.js";
import { type EvidenceSource, EvidenceUnavailable } from "./evidence-source.js";
import { type WirePrice, VENUE_CODES, snapshotDigest } from "./wire.js";

export const WIRE_ENCODING = "COX/WIRE/V1";

export type ArchiveVenue = keyof typeof VENUE_CODES;

export interface ArchivedAttempt {
  step: number;
  venue: ArchiveVenue;
  outcome: string;
  artifactDigest: string | null;
}

export interface ArchivedPrice {
  venue: ArchiveVenue;
  step: number;
  candleStart: number;
  close: string;
  usdtUsd: string | null;
  usdtArtifactDigest: string | null;
  priceE8: string | null;
  tradeAgeMinutes: number;
  artifactDigest: string;
  admissible: boolean;
  rejection: string | null;
}

export interface ArchivedAsset {
  assetId: string;
  position: number;
  attempts: ArchivedAttempt[];
  price: ArchivedPrice | null;
}

export interface ArchivedCutoff {
  cutoff: number;
  snapshot: { digest: string | null; digestEncoding: string | null; admissible: boolean };
  assets: ArchivedAsset[];
  usdtUsd: { attempts: ArchivedAttempt[] };
}

export type ArchiveVerdict = "match" | "mismatch" | "skipped" | "inadmissible";

export interface ArchiveCheck {
  cutoff: number;
  verdict: ArchiveVerdict;
  findings: string[];
  snapshotDigest: string | null;
}

const TRADES = "trades";

function reason(error: unknown): string {
  if (error instanceof MonitorMathError) return error.code;
  throw error;
}

function conversionFinding(asset: ArchivedAsset, price: ArchivedPrice): string | null {
  if (price.priceE8 === null) return `${asset.assetId}: admissible price has no priceE8`;
  try {
    if (price.venue === "bybit") {
      if (price.usdtUsd === null) return `${asset.assetId}: Bybit price has no USDT/USD rate`;
      const expected = usdtToE8(price.close, price.usdtUsd);
      return expected.toString() === price.priceE8 ? null : `${asset.assetId}: priceE8 ${price.priceE8} is not ${price.close} USDT at ${price.usdtUsd}, expected ${expected}`;
    }
    const expected = usdToE8(price.close);
    return expected.toString() === price.priceE8 ? null : `${asset.assetId}: priceE8 ${price.priceE8} is not the close ${price.close}, expected ${expected}`;
  } catch (error) {
    return `${asset.assetId}: close cannot be converted (${reason(error)})`;
  }
}

function fallbackFindings(asset: ArchivedAsset, price: ArchivedPrice): string[] {
  const findings: string[] = [];
  const earlier = asset.attempts.filter((attempt) => attempt.step < price.step && attempt.outcome === TRADES);
  for (const attempt of earlier) findings.push(`${asset.assetId}: step ${attempt.step} (${attempt.venue}) had trades but step ${price.step} was used`);
  if (!asset.attempts.some((attempt) => attempt.step === 1)) findings.push(`${asset.assetId}: no Kraken cutoff-candle attempt is archived`);
  if (!asset.attempts.some((attempt) => attempt.step === price.step && attempt.venue === price.venue && attempt.outcome === TRADES)) {
    findings.push(`${asset.assetId}: no archived attempt shows trades at step ${price.step} on ${price.venue}`);
  }
  return findings;
}

export function checkArchivedCutoff(archived: ArchivedCutoff): ArchiveCheck {
  const { cutoff, snapshot } = archived;
  const done = (verdict: ArchiveVerdict, findings: string[], digest: string | null = null): ArchiveCheck => ({ cutoff, verdict, findings, snapshotDigest: digest });

  if (!snapshot.admissible) {
    if (snapshot.digest === null) return done("inadmissible", []);
    if (snapshot.digestEncoding !== WIRE_ENCODING) return done("skipped", [`inadmissible snapshot carries a digest in encoding ${snapshot.digestEncoding ?? "unlabelled"}, not ${WIRE_ENCODING}`]);
    return done("mismatch", ["an inadmissible snapshot carries a digest"]);
  }
  if (snapshot.digestEncoding !== WIRE_ENCODING) return done("skipped", [`digest encoding is ${snapshot.digestEncoding ?? "unlabelled"}, not ${WIRE_ENCODING}`]);
  if (snapshot.digest === null) return done("mismatch", ["an admissible snapshot has no digest"]);

  const findings: string[] = [];
  const prices: WirePrice[] = [];
  archived.assets.forEach((asset, index) => {
    if (asset.position !== index) findings.push(`${asset.assetId}: position ${asset.position} is not its place ${index} in the roster order`);
    const price = asset.price;
    if (price === null) {
      findings.push(`${asset.assetId}: no price in an admissible snapshot`);
      return;
    }
    if (!price.admissible) findings.push(`${asset.assetId}: inadmissible price (${price.rejection ?? "no reason"}) in an admissible snapshot`);
    const conversion = conversionFinding(asset, price);
    if (conversion) findings.push(conversion);
    findings.push(...fallbackFindings(asset, price));
    if (price.priceE8 !== null && /^[0-9]+$/.test(price.priceE8)) {
      prices.push({
        assetId: asset.assetId,
        venue: VENUE_CODES[price.venue] ?? -1,
        step: price.step,
        candleStart: BigInt(price.candleStart),
        priceE8: BigInt(price.priceE8),
        tradeAgeMinutes: price.tradeAgeMinutes,
      });
    }
  });

  let recomputed: string | null = null;
  if (prices.length === archived.assets.length) {
    try {
      recomputed = snapshotDigest(BigInt(cutoff), archived.assets.map((asset) => asset.assetId), prices);
      if (recomputed !== snapshot.digest) findings.push(`snapshot digest ${snapshot.digest} does not match the recomputed ${recomputed}`);
    } catch (error) {
      findings.push(`snapshot cannot be encoded (${reason(error)})`);
    }
  }
  return done(findings.length === 0 ? "match" : "mismatch", findings, recomputed);
}

export function artifactDigests(archived: ArchivedCutoff): string[] {
  const digests = new Set<string>();
  const add = (digest: string | null) => {
    if (digest !== null) digests.add(digest);
  };
  for (const asset of archived.assets) {
    asset.attempts.forEach((attempt) => add(attempt.artifactDigest));
    if (asset.price) {
      add(asset.price.artifactDigest);
      add(asset.price.usdtArtifactDigest);
    }
  }
  archived.usdtUsd.attempts.forEach((attempt) => add(attempt.artifactDigest));
  return [...digests].sort();
}

export async function checkArtifacts(archived: ArchivedCutoff, source: EvidenceSource): Promise<string[]> {
  const findings: string[] = [];
  for (const digest of artifactDigests(archived)) {
    try {
      if (!(await source.hasArtifact(digest))) findings.push(`artifact ${digest} is not in the archive`);
    } catch (error) {
      if (!(error instanceof EvidenceUnavailable)) throw error;
      findings.push(`artifact ${digest}: ${error.message}`);
    }
  }
  return findings;
}
