import { MonitorMathError } from "./arithmetic.js";
import type { ArchiveVenue, ArchivedAttempt, ArchivedCutoff } from "./archive.js";
import { sameDecimal } from "./decimal.js";

export const USDT = "USDT";
export const BULK_MINUTES: Record<ArchiveVenue, number> = { kraken: 720, coinbase: 300, bybit: 1000 };

export interface VenueCandle {
  start: number;
  close: string;
  hasTrades: boolean;
  final: boolean;
}

export interface CandleSource {
  candles(venue: ArchiveVenue, assetId: string, from: number, to: number): Promise<VenueCandle[] | "not-listed">;
}

export interface VenueCheck {
  findings: string[];
  unverified: string[];
}

interface Expectation {
  cutoff: number;
  venue: ArchiveVenue;
  assetId: string;
  start: number;
  close: string | null;
  label: string;
}

const EMPTY = "empty";
const TRADES = "trades";

function equal(left: string, right: string): boolean {
  try {
    return sameDecimal(left, right);
  } catch (error) {
    if (error instanceof MonitorMathError) return false;
    throw error;
  }
}

function emptyAttempts(attempts: readonly ArchivedAttempt[], before: number): ArchivedAttempt[] {
  return attempts.filter((attempt) => attempt.step < before && attempt.step < 4 && attempt.outcome === EMPTY);
}

function expectations(archived: ArchivedCutoff): Expectation[] {
  const { cutoff } = archived;
  const candle = cutoff - 60;
  const list: Expectation[] = [];
  for (const asset of archived.assets) {
    const price = asset.price;
    if (!price) continue;
    for (const attempt of emptyAttempts(asset.attempts, price.step)) {
      list.push({ cutoff, venue: attempt.venue, assetId: asset.assetId, start: candle, close: null, label: `${asset.assetId} on ${attempt.venue}` });
    }
    list.push({ cutoff, venue: price.venue, assetId: asset.assetId, start: price.candleStart, close: price.close, label: `${asset.assetId} on ${price.venue}` });
    if (price.step === 4) {
      for (let start = price.candleStart + 60; start < candle; start += 60) {
        list.push({ cutoff, venue: "kraken", assetId: asset.assetId, start, close: null, label: `${asset.assetId} on kraken` });
      }
    }
    if (price.venue === "bybit" && price.usdtUsd !== null) {
      const source = archived.usdtUsd.attempts.find((attempt) => attempt.outcome === TRADES);
      for (const attempt of emptyAttempts(archived.usdtUsd.attempts, source?.step ?? 0)) {
        list.push({ cutoff, venue: attempt.venue, assetId: USDT, start: candle, close: null, label: `USDT/USD on ${attempt.venue}` });
      }
      if (source) list.push({ cutoff, venue: source.venue, assetId: USDT, start: candle, close: price.usdtUsd, label: `USDT/USD on ${source.venue}` });
      else list.push({ cutoff, venue: "kraken", assetId: USDT, start: candle, close: price.usdtUsd, label: "USDT/USD on kraken" });
    }
  }
  return list;
}

function unique(list: Expectation[]): Expectation[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = `${item.cutoff}|${item.venue}|${item.assetId}|${item.start}|${item.close ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function judge(expected: Expectation, candle: VenueCandle | undefined, check: VenueCheck): void {
  const at = `${expected.label} candle ${expected.start}`;
  if (candle && !candle.final) {
    check.unverified.push(`${at} is not final at the venue yet`);
    return;
  }
  if (expected.close === null) {
    if (candle?.hasTrades) check.findings.push(`${at} has trades at the venue but the archive recorded none`);
    return;
  }
  if (!candle) {
    check.unverified.push(`${at} is no longer returned by the venue`);
    return;
  }
  if (!candle.hasTrades) check.findings.push(`${at} has no trades at the venue but the archive used its close`);
  else if (!equal(candle.close, expected.close)) check.findings.push(`${at} closed at ${candle.close} at the venue, not the archived ${expected.close}`);
}

export async function checkAgainstVenues(cutoffs: readonly ArchivedCutoff[], source: CandleSource): Promise<Map<number, VenueCheck>> {
  const results = new Map<number, VenueCheck>(cutoffs.map((item) => [item.cutoff, { findings: [], unverified: [] }]));
  const groups = new Map<string, Expectation[]>();
  for (const expected of cutoffs.flatMap((item) => unique(expectations(item)))) {
    const key = `${expected.venue}|${expected.assetId}`;
    groups.set(key, [...(groups.get(key) ?? []), expected]);
  }

  for (const group of groups.values()) {
    const { venue, assetId } = group[0]!;
    const sorted = [...group].sort((left, right) => left.start - right.start);
    const span = BULK_MINUTES[venue] * 60;
    let index = 0;
    while (index < sorted.length) {
      const from = sorted[index]!.start;
      const batch = sorted.filter((item, position) => position >= index && item.start < from + span);
      const to = batch[batch.length - 1]!.start + 60;
      const fetched = await source.candles(venue, assetId, from, to);
      for (const expected of batch) {
        const check = results.get(expected.cutoff)!;
        if (fetched === "not-listed") {
          if (expected.close !== null) check.findings.push(`${expected.label} is not listed at the venue but the archive used its close`);
        } else {
          judge(expected, fetched.find((candle) => candle.start === expected.start), check);
        }
      }
      index += batch.length;
    }
  }
  return results;
}
