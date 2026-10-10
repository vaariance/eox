import { describe, expect, it } from "vitest";
import {
  BULK_LIMITS,
  bybitKlines,
  coinbaseCandles,
  convertedE8,
  exactE8,
  isPositiveDecimal,
  krakenOhlc,
  parseLossless,
  ROSTER,
  VenueClient,
  VenueError,
} from "../src/index.js";
import { FakeClock, FakeHttp, recordedText, UA } from "./helpers.js";

describe("exact prices", () => {
  it("converts a close to USD x 10^8 exactly and refuses any text the spec cannot represent", () => {
    expect(exactE8("82758.6")).toBe(8_275_860_000_000n);
    expect(exactE8("0.8650")).toBe(86_500_000n);
    expect(exactE8("0.00000001")).toBe(1n);
    expect(exactE8("0.12345678")).toBe(12_345_678n);
    expect(exactE8("184467440737.09551615")).toBe((1n << 64n) - 1n);
    for (const refused of ["1.000000000", "0.000000001", "01.5", "1.", ".5", "-1", "1e5", "184467440737.09551616"]) {
      expect(exactE8(refused), refused).toBeNull();
    }
  });

  it("converts a Bybit USDT close with the one named rounding, half away from zero", () => {
    expect(convertedE8("0.331", "0.99985")).toBe(33_095_035n);
    expect(convertedE8("0.000000015", "1")).toBe(2n);
    expect(convertedE8("0.000000014", "1")).toBe(1n);
    expect(convertedE8("-0.000000015", "1")).toBe(-2n);
  });

  it("knows a positive decimal", () => {
    expect(isPositiveDecimal("0.0001")).toBe(true);
    expect(isPositiveDecimal("0.000")).toBe(false);
    expect(isPositiveDecimal("-1")).toBe(false);
  });

  it("keeps JSON number source text instead of binary floats", () => {
    expect(parseLossless('{"close":0.8650,"big":82937.930000001}')).toEqual({ close: "0.8650", big: "82937.930000001" });
  });
});

describe("roster", () => {
  it("has the 30 assets of SYSTEM.md section 4.1 in canonical order with their venue gaps", () => {
    expect(ROSTER).toHaveLength(30);
    expect(ROSTER.map((a) => a.position)).toEqual([...Array(30).keys()]);
    expect(new Set(ROSTER.map((a) => a.assetId)).size).toBe(30);
    expect(ROSTER.filter((a) => a.coinbaseProduct === null).map((a) => a.assetId)).toEqual(["TRX", "JUP"]);
    expect(ROSTER.filter((a) => a.bybitSymbol === null).map((a) => a.assetId)).toEqual(["ZEC", "TAO"]);
    expect(ROSTER[0]).toMatchObject({ assetId: "BTC", krakenRestPair: "XXBTZUSD" });
    expect(ROSTER[29]).toMatchObject({ assetId: "W", krakenWsSymbol: "W/USD" });
  });
});

describe("venue client", () => {
  const client = (http: FakeHttp, clock: FakeClock, venue: "kraken" | "coinbase" | "bybit" = "coinbase", rps = 2) =>
    new VenueClient(venue, { requestsPerSecond: rps, userAgent: UA, fetch: http.fetch, now: clock.now, sleep: clock.sleep, random: () => 1 });

  it("refuses a budget above half the published limit and a missing User-Agent", () => {
    const http = new FakeHttp();
    const clock = new FakeClock(0);
    expect(() => client(http, clock, "coinbase", 3)).toThrow(/outside/);
    expect(() => client(http, clock, "kraken", 1)).toThrow(/outside/);
    expect(() => new VenueClient("bybit", { requestsPerSecond: 1, userAgent: " " })).toThrow(/User-Agent/);
  });

  it("spaces requests, sends one at a time and serves repeats from the cache", async () => {
    const http = new FakeHttp().on(/a/, { body: "[]" }).on(/b/, { body: "[]" });
    const clock = new FakeClock(1_000_000);
    const c = client(http, clock);
    await Promise.all([c.get("https://x.test/a", Infinity), c.get("https://x.test/b", Infinity), c.get("https://x.test/a", Infinity)]);
    expect(http.calls).toEqual(["https://x.test/a", "https://x.test/b"]);
    expect(clock.sleeps).toEqual([500]);
    expect(c.metrics).toMatchObject({ requests: 2, cacheHits: 1 });
  });

  it("backs off on a rate limit, honours Retry-After and recovers", async () => {
    const http = new FakeHttp().on(/x/, { status: 429, body: "{}", headers: { "retry-after": "3" } }, { body: "[]" });
    const clock = new FakeClock(0);
    const c = client(http, clock);
    const response = await c.get("https://x.test/x", Infinity);
    expect(response.status).toBe(200);
    expect(clock.sleeps).toEqual([3000]);
    expect(c.metrics).toMatchObject({ requests: 2, rateLimited: 1, backoffMs: 3000 });
  });

  it("recognises Kraken and Bybit rate-limit bodies and gives up at the deadline", async () => {
    const clock = new FakeClock(0);
    const kraken = client(new FakeHttp().on(/k/, { body: '{"error":["EAPI:Rate limit exceeded"]}' }), clock, "kraken", 0.5);
    await expect(kraken.get("https://k.test/k", 1_000)).rejects.toMatchObject({ kind: "rate-limited" });
    const bybit = client(new FakeHttp().on(/b/, { body: '{"retCode":10006,"retMsg":"Too many visits"}' }), clock, "bybit", 2);
    await expect(bybit.get("https://b.test/b", clock.ms + 100)).rejects.toMatchObject({ kind: "rate-limited" });
  });

  it("opens the circuit breaker after five consecutive failures", async () => {
    const http = new FakeHttp().on(/x/, { status: 503, body: "down" });
    const clock = new FakeClock(0);
    const c = client(http, clock);
    for (let i = 0; i < 5; i += 1) await expect(c.get(`https://x.test/x${i}`, Infinity)).rejects.toBeInstanceOf(VenueError);
    expect(c.breakerOpen).toBe(true);
    await expect(c.get("https://x.test/x9", Infinity)).rejects.toThrow(/circuit breaker open/);
    expect(http.calls).toHaveLength(5);
    clock.ms += 60_000;
    expect(c.breakerOpen).toBe(false);
  });
});

describe("REST adapters on recorded responses", () => {
  const clock = new FakeClock(1_791_662_000_000);
  const make = (venue: "kraken" | "coinbase" | "bybit", file: string) =>
    new VenueClient(venue, { requestsPerSecond: venue === "kraken" ? 0.5 : 2, userAgent: UA, fetch: new FakeHttp().on(/./, { body: recordedText(file) }).fetch, now: clock.now, sleep: clock.sleep });

  it("reads Kraken OHLC with carried empty minutes and the last-committed marker", async () => {
    const page = await krakenOhlc(make("kraken", "kraken-rest-ohlc-APTUSD.json"), "APTUSD", null, Infinity);
    expect(page.candles[0]).toEqual({ start: 1791660720, close: "0.8620", tradeEvidence: "2", hasTrades: true, final: true });
    expect(page.candles[1]).toMatchObject({ start: 1791660780, close: "0.8620", tradeEvidence: "0", hasTrades: false });
    expect(page.candles.at(-1)!.final).toBe(false);
  });

  it("reads Coinbase candles as exact text and treats them final five seconds after the minute", async () => {
    const page = await coinbaseCandles(make("coinbase", "coinbase-candles-APT-USD.json"), "APT-USD", 1791660720, 1791661320, 1791661385, Infinity);
    expect(page.candles[0]).toEqual({ start: 1791661320, close: "0.8571", tradeEvidence: "392.765", hasTrades: true, final: true });
    expect(page.candles.find((c) => c.start === 1791660960)).toMatchObject({ close: "0.8623", tradeEvidence: "41.68" });
  });

  it("reads Bybit klines and treats only the newest candle as unfinished", async () => {
    const page = await bybitKlines(make("bybit", "bybit-kline-APTUSDT.json"), "APTUSDT", 1791660720, 1791661320, Infinity);
    expect(page.candles[0]).toMatchObject({ start: 1791661320, close: "0.8579", final: false });
    expect(page.candles[1]).toMatchObject({ start: 1791661260, close: "0.8598", tradeEvidence: "8068.49", hasTrades: true, final: true });
  });

  it("states the bulk limits per call", () => {
    expect(BULK_LIMITS).toEqual({ kraken: 720, coinbase: 300, bybit: 1000 });
  });
});
