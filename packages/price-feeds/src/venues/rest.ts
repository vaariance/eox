import { isDecimal } from "../decimal.js";
import { decodeUtf8, parseLossless } from "../json.js";
import { VenueError, type RawResponse, type VenueClient } from "../venue-client.js";

export interface Candle {
  start: number;
  close: string;
  tradeEvidence: string;
  hasTrades: boolean;
  final: boolean;
}

export interface CandlePage {
  response: RawResponse;
  candles: Candle[];
  notListed: boolean;
}

const KRAKEN_REST = "https://api.kraken.com/0/public/OHLC";
const COINBASE_REST = "https://api.exchange.coinbase.com/products";
const BYBIT_REST = "https://api.bybit.com/v5/market/kline";
const COINBASE_FINAL_DELAY_SECONDS = 5;

function malformed(response: RawResponse, detail: string): VenueError {
  return new VenueError(response.venue, "malformed", detail, response);
}

function body(response: RawResponse): unknown {
  try {
    return parseLossless(decodeUtf8(response.body));
  } catch {
    throw malformed(response, "response is not JSON");
  }
}

function decimal(value: unknown, response: RawResponse, field: string): string {
  if (typeof value !== "string" || !isDecimal(value)) throw malformed(response, `${field} is not a decimal`);
  return value;
}

function positive(value: string): boolean {
  return /[1-9]/.test(value);
}

function minute(value: unknown, response: RawResponse, field: string, divisor = 1): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw malformed(response, `${field} is not an integer`);
  const seconds = Number(value) / divisor;
  if (!Number.isSafeInteger(seconds) || seconds % 60 !== 0) throw malformed(response, `${field} is not a minute boundary`);
  return seconds;
}

export async function krakenOhlc(client: VenueClient, pair: string, since: number | null, deadline: number): Promise<CandlePage> {
  const query = new URLSearchParams({ pair, interval: "1" });
  if (since !== null) query.set("since", String(since));
  const response = await client.get(`${KRAKEN_REST}?${query}`, deadline);
  const parsed = body(response) as { error?: unknown; result?: Record<string, unknown> };
  if (!Array.isArray(parsed.error)) throw malformed(response, "missing error array");
  if (parsed.error.some((e) => typeof e === "string" && e.includes("Unknown asset pair"))) return { response, candles: [], notListed: true };
  if (parsed.error.length > 0 || !parsed.result) throw malformed(response, `error ${JSON.stringify(parsed.error)}`);
  const keys = Object.keys(parsed.result).filter((key) => key !== "last");
  if (keys.length !== 1 || !Array.isArray(parsed.result[keys[0]!])) throw malformed(response, "expected exactly one pair in the result");
  const last = minute(parsed.result.last, response, "last");
  const candles = (parsed.result[keys[0]!] as unknown[]).map((row) => {
    if (!Array.isArray(row) || row.length !== 8) throw malformed(response, "candle row is not 8 fields");
    const start = minute(row[0], response, "time");
    const count = row[7];
    if (typeof count !== "string" || !/^\d+$/.test(count)) throw malformed(response, "count is not an integer");
    return { start, close: decimal(row[4], response, "close"), tradeEvidence: count, hasTrades: count !== "0", final: start <= last };
  });
  return { response, candles, notListed: false };
}

export async function coinbaseCandles(client: VenueClient, product: string, start: number, end: number, now: number, deadline: number): Promise<CandlePage> {
  const query = new URLSearchParams({ granularity: "60", start: String(start), end: String(end) });
  const response = await client.get(`${COINBASE_REST}/${encodeURIComponent(product)}/candles?${query}`, deadline);
  if (response.status === 404) return { response, candles: [], notListed: true };
  const parsed = body(response);
  if (response.status !== 200 || !Array.isArray(parsed)) throw malformed(response, `HTTP ${response.status}`);
  const candles = parsed.map((row) => {
    if (!Array.isArray(row) || row.length !== 6) throw malformed(response, "candle row is not 6 fields");
    const begin = minute(row[0], response, "time");
    const volume = decimal(row[5], response, "volume");
    return {
      start: begin,
      close: decimal(row[4], response, "close"),
      tradeEvidence: volume,
      hasTrades: positive(volume),
      final: now >= begin + 60 + COINBASE_FINAL_DELAY_SECONDS,
    };
  });
  return { response, candles, notListed: false };
}

export async function bybitKlines(client: VenueClient, symbol: string, start: number, end: number, deadline: number): Promise<CandlePage> {
  const query = new URLSearchParams({ category: "spot", symbol, interval: "1", start: String(start * 1000), end: String(end * 1000) });
  const response = await client.get(`${BYBIT_REST}?${query}`, deadline);
  const parsed = body(response) as { retCode?: unknown; retMsg?: unknown; result?: { list?: unknown } };
  if (parsed.retCode === "10001" && typeof parsed.retMsg === "string" && /symbol/i.test(parsed.retMsg)) {
    return { response, candles: [], notListed: true };
  }
  if (parsed.retCode !== "0" || !Array.isArray(parsed.result?.list)) throw malformed(response, `retCode ${String(parsed.retCode)}`);
  const rows = (parsed.result.list as unknown[]).map((row) => {
    if (!Array.isArray(row) || row.length !== 7) throw malformed(response, "kline row is not 7 fields");
    const volume = decimal(row[5], response, "volume");
    return { start: minute(row[0], response, "start", 1000), close: decimal(row[4], response, "close"), tradeEvidence: volume, hasTrades: positive(volume) };
  });
  const latest = Math.max(...rows.map((row) => row.start));
  return { response, candles: rows.map((row) => ({ ...row, final: row.start < latest })), notListed: false };
}
