import { createHash } from "node:crypto";
import { convertedE8, exactE8, isPositiveDecimal } from "./decimal.js";
import { USDT_USD, type RosterAsset } from "./roster.js";
import { VenueError, type RawResponse, type RestVenue, type VenueClient } from "./venue-client.js";
import type { KrakenWsFeed, WsCandle } from "./venues/kraken-ws.js";
import { bybitKlines, coinbaseCandles, krakenOhlc, type Candle, type CandlePage } from "./venues/rest.js";

export const MAX_TRADE_AGE_MINUTES = 30;
export const ARCHIVE_DEADLINE_SECONDS = 30;

export type Venue = RestVenue;
export type FallbackStep = 1 | 2 | 3 | 4;
export type AttemptOutcome = "trades" | "empty" | "not-listed" | "unavailable" | "rate-limited" | "malformed";
export type PriceRejection = "non_positive_price" | "excess_decimals" | "trade_age_exceeded";

export interface Evidence {
  venue: Venue;
  request: string;
  contentType: string | null;
  body: Uint8Array;
  sha256: string;
}

export interface Attempt {
  venue: Venue;
  step: FallbackStep;
  outcome: AttemptOutcome;
  evidence: Evidence | null;
  detail: string | null;
}

export interface ResolvedPrice {
  venue: Venue;
  step: FallbackStep;
  candleStart: number;
  close: string;
  usdtUsd: string | null;
  usdtEvidence: Evidence | null;
  priceE8: string | null;
  tradeEvidence: string;
  tradeAgeMinutes: number;
  evidence: Evidence;
  rejection: PriceRejection | null;
}

export interface Resolution {
  assetId: string;
  cutoff: number;
  attempts: Attempt[];
  price: ResolvedPrice | null;
}

export interface UsdtResolution {
  cutoff: number;
  attempts: Attempt[];
  close: string | null;
  evidence: Evidence | null;
}

export interface ResolverDeps {
  ws: KrakenWsFeed | null;
  kraken: VenueClient;
  coinbase: VenueClient | null;
  bybit: VenueClient | null;
  now?: () => number;
}

interface Found {
  candle: { start: number; close: string; tradeEvidence: string };
  evidence: Evidence;
}

type StepResult = { outcome: "trades"; found: Found } | { outcome: Exclude<AttemptOutcome, "trades">; evidence: Evidence | null; detail: string | null };

function fromResponse(response: RawResponse): Evidence {
  return { venue: response.venue, request: response.request, contentType: response.contentType, body: response.body, sha256: response.sha256 };
}

function fromFrames(symbol: string, candle: WsCandle): Evidence {
  const body = new TextEncoder().encode(candle.frames.join("\n"));
  return {
    venue: "kraken",
    request: `WS wss://ws.kraken.com/v2 ohlc ${symbol} interval 1 candle ${candle.start}`,
    contentType: "application/x-ndjson",
    body,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

function failure(error: unknown): StepResult {
  if (!(error instanceof VenueError)) throw error;
  const outcome = error.kind === "rate-limited" ? "rate-limited" : error.kind === "malformed" ? "malformed" : "unavailable";
  return { outcome, evidence: error.response ? fromResponse(error.response) : null, detail: error.message };
}

function pick(page: CandlePage, start: number, missing: "empty" | "unavailable"): StepResult {
  const evidence = fromResponse(page.response);
  if (page.notListed) return { outcome: "not-listed", evidence, detail: null };
  const candle: Candle | undefined = page.candles.find((c) => c.start === start);
  if (!candle && missing === "unavailable") return { outcome: "unavailable", evidence, detail: "cutoff candle is missing from the response" };
  if (candle && !candle.final) return { outcome: "unavailable", evidence, detail: "cutoff candle is not final yet" };
  if (!candle || !candle.hasTrades) return { outcome: "empty", evidence, detail: null };
  return { outcome: "trades", found: { candle, evidence } };
}

async function krakenCutoffCandle(deps: ResolverDeps, wsSymbol: string, restPair: string, cutoff: number, deadline: number): Promise<StepResult> {
  const start = cutoff - 60;
  const live = deps.ws?.candle(wsSymbol, start);
  if (live?.status === "trades") return { outcome: "trades", found: { candle: { start, close: live.candle.close, tradeEvidence: live.candle.trades }, evidence: fromFrames(wsSymbol, live.candle) } };
  if (live?.status === "empty") return { outcome: "empty", evidence: null, detail: "no WebSocket update for a fully covered minute" };
  try {
    return pick(await krakenOhlc(deps.kraken, restPair, start - 60, deadline), start, "unavailable");
  } catch (error) {
    return failure(error);
  }
}

async function coinbaseCutoffCandle(deps: ResolverDeps, product: string, cutoff: number, now: number, deadline: number): Promise<StepResult> {
  if (!deps.coinbase) return { outcome: "unavailable", evidence: null, detail: "Coinbase is disabled by configuration" };
  try {
    return pick(await coinbaseCandles(deps.coinbase, product, cutoff - 120, cutoff, now, deadline), cutoff - 60, "empty");
  } catch (error) {
    return failure(error);
  }
}

function attempt(venue: Venue, step: FallbackStep, result: StepResult): Attempt {
  return result.outcome === "trades"
    ? { venue, step, outcome: "trades", evidence: result.found.evidence, detail: null }
    : { venue, step, outcome: result.outcome, evidence: result.evidence, detail: result.detail };
}

function assertCutoff(cutoff: number): void {
  if (!Number.isSafeInteger(cutoff) || cutoff <= 0 || cutoff % 60 !== 0) throw new Error(`invalid cutoff ${cutoff}`);
}

export async function resolveUsdtUsd(deps: ResolverDeps, cutoff: number): Promise<UsdtResolution> {
  assertCutoff(cutoff);
  const now = (deps.now ?? Date.now)() / 1000;
  const deadline = (cutoff + ARCHIVE_DEADLINE_SECONDS) * 1000;
  const attempts: Attempt[] = [];
  const kraken = await krakenCutoffCandle(deps, USDT_USD.krakenWsSymbol, USDT_USD.krakenRestPair, cutoff, deadline);
  attempts.push(attempt("kraken", 1, kraken));
  if (kraken.outcome === "trades") return { cutoff, attempts, close: kraken.found.candle.close, evidence: kraken.found.evidence };
  const coinbase = await coinbaseCutoffCandle(deps, USDT_USD.coinbaseProduct, cutoff, now, deadline);
  attempts.push(attempt("coinbase", 2, coinbase));
  if (coinbase.outcome === "trades") return { cutoff, attempts, close: coinbase.found.candle.close, evidence: coinbase.found.evidence };
  return { cutoff, attempts, close: null, evidence: null };
}

async function carriedKrakenClose(deps: ResolverDeps, asset: RosterAsset, cutoff: number, deadline: number): Promise<StepResult> {
  const live = deps.ws?.lastTradeBefore(asset.krakenWsSymbol, cutoff - 60);
  if (live) {
    return { outcome: "trades", found: { candle: { start: live.start, close: live.close, tradeEvidence: live.trades }, evidence: fromFrames(asset.krakenWsSymbol, live) } };
  }
  try {
    const page = await krakenOhlc(deps.kraken, asset.krakenRestPair, null, deadline);
    const evidence = fromResponse(page.response);
    if (page.notListed) return { outcome: "not-listed", evidence, detail: null };
    const traded = page.candles.filter((c) => c.final && c.hasTrades && c.start < cutoff - 60).sort((a, b) => b.start - a.start)[0];
    if (!traded) return { outcome: "empty", evidence, detail: "no Kraken trade in the returned history" };
    return { outcome: "trades", found: { candle: traded, evidence } };
  } catch (error) {
    return failure(error);
  }
}

function price(venue: Venue, step: FallbackStep, cutoff: number, found: Found, usdt: UsdtResolution | null): ResolvedPrice {
  const { candle, evidence } = found;
  const tradeAgeMinutes = (cutoff - candle.start - 60) / 60;
  let priceE8: string | null;
  let rejection: PriceRejection | null = null;
  if (venue === "bybit") {
    priceE8 = convertedE8(candle.close, usdt!.close!).toString();
  } else {
    const exact = exactE8(candle.close);
    priceE8 = exact === null ? null : exact.toString();
    if (exact === null) rejection = "excess_decimals";
  }
  if (rejection === null && !isPositiveDecimal(candle.close)) rejection = "non_positive_price";
  if (rejection === null && tradeAgeMinutes > MAX_TRADE_AGE_MINUTES) rejection = "trade_age_exceeded";
  return {
    venue,
    step,
    candleStart: candle.start,
    close: candle.close,
    usdtUsd: venue === "bybit" ? usdt!.close : null,
    usdtEvidence: venue === "bybit" ? usdt!.evidence : null,
    priceE8,
    tradeEvidence: candle.tradeEvidence,
    tradeAgeMinutes,
    evidence,
    rejection,
  };
}

export async function resolveCutoffPrice(
  deps: ResolverDeps,
  asset: RosterAsset,
  cutoff: number,
  usdt: () => Promise<UsdtResolution>,
): Promise<Resolution> {
  assertCutoff(cutoff);
  const now = (deps.now ?? Date.now)() / 1000;
  const deadline = (cutoff + ARCHIVE_DEADLINE_SECONDS) * 1000;
  const attempts: Attempt[] = [];
  const done = (venue: Venue, step: FallbackStep, found: Found, conversion: UsdtResolution | null = null): Resolution => ({
    assetId: asset.assetId,
    cutoff,
    attempts,
    price: price(venue, step, cutoff, found, conversion),
  });

  const kraken = await krakenCutoffCandle(deps, asset.krakenWsSymbol, asset.krakenRestPair, cutoff, deadline);
  attempts.push(attempt("kraken", 1, kraken));
  if (kraken.outcome === "trades") return done("kraken", 1, kraken.found);

  if (asset.coinbaseProduct === null) {
    attempts.push({ venue: "coinbase", step: 2, outcome: "not-listed", evidence: null, detail: null });
  } else {
    const coinbase = await coinbaseCutoffCandle(deps, asset.coinbaseProduct, cutoff, now, deadline);
    attempts.push(attempt("coinbase", 2, coinbase));
    if (coinbase.outcome === "trades") return done("coinbase", 2, coinbase.found);
  }

  if (asset.bybitSymbol === null) {
    attempts.push({ venue: "bybit", step: 3, outcome: "not-listed", evidence: null, detail: null });
  } else if (!deps.bybit) {
    attempts.push({ venue: "bybit", step: 3, outcome: "unavailable", evidence: null, detail: "Bybit is disabled by configuration" });
  } else {
    const conversion = await usdt();
    if (conversion.close === null) {
      attempts.push({ venue: "bybit", step: 3, outcome: "unavailable", evidence: null, detail: "no USDT/USD trade in the cutoff minute" });
    } else {
      let bybit: StepResult;
      try {
        bybit = pick(await bybitKlines(deps.bybit, asset.bybitSymbol, cutoff - 60, cutoff + 60, deadline), cutoff - 60, "unavailable");
      } catch (error) {
        bybit = failure(error);
      }
      attempts.push(attempt("bybit", 3, bybit));
      if (bybit.outcome === "trades") return done("bybit", 3, bybit.found, conversion);
    }
  }

  const carried = await carriedKrakenClose(deps, asset, cutoff, deadline);
  attempts.push(attempt("kraken", 4, carried));
  if (carried.outcome === "trades") return done("kraken", 4, carried.found);
  return { assetId: asset.assetId, cutoff, attempts, price: null };
}
