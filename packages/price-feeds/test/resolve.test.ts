import { describe, expect, it } from "vitest";
import {
  KrakenWsFeed,
  resolveCutoffPrice,
  resolveUsdtUsd,
  rosterAsset,
  VenueClient,
  type ResolverDeps,
  type SocketLike,
  type UsdtResolution,
} from "../src/index.js";
import { FakeClock, FakeHttp, recordedText, UA } from "./helpers.js";

class FakeSocket implements SocketLike {
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  readonly sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.({});
  }
  frame(text: string) {
    this.onmessage?.({ data: text });
  }
}

const CUTOFF = 1_800_000_000 - (1_800_000_000 % 60);
const subscribed = (symbol: string) => JSON.stringify({ method: "subscribe", result: { channel: "ohlc", interval: 1, snapshot: true, symbol }, success: true });
const update = (symbol: string, start: number, close: string, trades: number) =>
  `{"channel":"ohlc","type":"update","data":[{"symbol":"${symbol}","open":${close},"high":${close},"low":${close},"close":${close},"trades":${trades},"volume":1.5,"vwap":${close},"interval_begin":"${new Date(start * 1000).toISOString()}","interval":1}]}`;

function feed(clock: FakeClock, symbols: string[]) {
  const sockets: FakeSocket[] = [];
  const scheduled: number[] = [];
  const ws = new KrakenWsFeed({
    symbols,
    now: clock.now,
    random: () => 0,
    connect: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    schedule: (fn, ms) => {
      scheduled.push(ms);
      fn();
    },
  });
  ws.start();
  sockets[0]!.onopen?.({});
  return { ws, sockets, scheduled };
}

describe("Kraken WebSocket feed", () => {
  it("subscribes once to every symbol and decodes the recorded frames losslessly", () => {
    const clock = new FakeClock(1_791_660_312_000);
    const { ws, sockets } = feed(clock, ["BTC/USD", "APT/USD", "USDT/USD"]);
    expect(JSON.parse(sockets[0]!.sent[0]!)).toMatchObject({ method: "subscribe", params: { channel: "ohlc", interval: 1, symbol: ["BTC/USD", "APT/USD", "USDT/USD"] } });
    for (const frame of JSON.parse(recordedText("kraken-ws-ohlc.json")) as { receivedAt: number; text: string }[]) {
      clock.ms = frame.receivedAt;
      sockets[0]!.frame(frame.text);
    }
    expect(ws.metrics.malformedFrames).toBe(0);
    const last = ws.lastTradeBefore("APT/USD", Date.parse("2026-10-10T19:45:00Z") / 1000);
    expect(last === null || /^\d+\.\d+$/.test(last.close)).toBe(true);
  });

  it("calls a fully covered minute empty only when no trade update arrived", () => {
    const clock = new FakeClock((CUTOFF - 300) * 1000);
    const { ws, sockets } = feed(clock, ["APT/USD"]);
    sockets[0]!.frame(subscribed("APT/USD"));
    clock.ms = (CUTOFF - 150) * 1000;
    sockets[0]!.frame(update("APT/USD", CUTOFF - 180, "0.8650", 3));
    expect(ws.candle("APT/USD", CUTOFF - 60)).toMatchObject({ status: "unknown" });
    clock.ms = (CUTOFF + 1) * 1000;
    sockets[0]!.frame('{"channel":"heartbeat"}');
    expect(ws.candle("APT/USD", CUTOFF - 60)).toEqual({ status: "empty" });
    const traded = ws.candle("APT/USD", CUTOFF - 180);
    expect(traded).toMatchObject({ status: "trades", candle: { close: "0.8650", trades: "3" } });
    expect(ws.lastTradeBefore("APT/USD", CUTOFF - 60)).toMatchObject({ start: CUTOFF - 180, close: "0.8650" });
  });

  it("does not trust minutes across a disconnect and resets its backoff after a successful subscription", () => {
    const clock = new FakeClock((CUTOFF - 300) * 1000);
    const { ws, sockets, scheduled } = feed(clock, ["BTC/USD"]);
    sockets[0]!.frame(subscribed("BTC/USD"));
    clock.ms = (CUTOFF - 91) * 1000;
    sockets[0]!.frame('{"channel":"heartbeat"}');
    clock.ms = (CUTOFF - 90) * 1000;
    sockets[0]!.close();
    sockets[1]!.onopen?.({});
    clock.ms = (CUTOFF - 30) * 1000;
    sockets[1]!.frame(subscribed("BTC/USD"));
    clock.ms = (CUTOFF + 2) * 1000;
    sockets[1]!.frame('{"channel":"heartbeat"}');
    expect(ws.candle("BTC/USD", CUTOFF - 60)).toMatchObject({ status: "unknown" });
    expect(ws.candle("BTC/USD", CUTOFF - 240)).toEqual({ status: "empty" });
    sockets[1]!.close();
    sockets[2]!.close();
    expect(scheduled).toEqual([500, 500, 1000]);
    expect(ws.metrics.disconnects).toBe(3);
  });
});

const kraken = (rows: string[], last: number) => `{"error":[],"result":{"X":[${rows.join(",")}],"last":${last}}}`;
const krow = (start: number, close: string, count: number) => `[${start},"${close}","${close}","${close}","${close}","${close}","1.0",${count}]`;
const coinbase = (rows: [number, string, string][]) => `[${rows.map(([t, close, vol]) => `[${t},${close},${close},${close},${close},${vol}]`).join(",")}]`;
const bybit = (rows: [number, string, string][]) => `{"retCode":0,"retMsg":"OK","result":{"category":"spot","list":[${rows.map(([t, close, vol]) => `["${t * 1000}","${close}","${close}","${close}","${close}","${vol}","1"]`).join(",")}]}}`;

function deps(http: FakeHttp, clock: FakeClock, options: { bybit?: boolean } = {}): ResolverDeps {
  const client = (venue: "kraken" | "coinbase" | "bybit") =>
    new VenueClient(venue, { requestsPerSecond: venue === "kraken" ? 0.5 : 2, userAgent: UA, fetch: http.fetch, now: clock.now, sleep: clock.sleep, random: () => 1 });
  return { ws: null, kraken: client("kraken"), coinbase: client("coinbase"), bybit: options.bybit === false ? null : client("bybit"), now: clock.now };
}

const noUsdt = async (): Promise<UsdtResolution> => {
  throw new Error("USDT/USD must not be resolved here");
};

describe("COX/PRICE-FALLBACK/V1", () => {
  it("takes Kraken's cutoff candle and asks no other venue when it has trades", async () => {
    const clock = new FakeClock((CUTOFF + 8) * 1000);
    const http = new FakeHttp().on(/kraken.*OHLC/, { body: kraken([krow(CUTOFF - 60, "82758.6", 80), krow(CUTOFF, "82760", 3)], CUTOFF) });
    const result = await resolveCutoffPrice(deps(http, clock), rosterAsset("BTC"), CUTOFF, noUsdt);
    expect(result.attempts.map((a) => [a.step, a.venue, a.outcome])).toEqual([[1, "kraken", "trades"]]);
    expect(result.price).toMatchObject({ venue: "kraken", step: 1, candleStart: CUTOFF - 60, close: "82758.6", priceE8: "8275860000000", tradeEvidence: "80", tradeAgeMinutes: 0, rejection: null });
    expect(http.calls).toHaveLength(1);
  });

  it("falls back to Coinbase when Kraken's minute is empty", async () => {
    const clock = new FakeClock((CUTOFF + 8) * 1000);
    const http = new FakeHttp()
      .on(/kraken.*OHLC/, { body: kraken([krow(CUTOFF - 60, "0.8620", 0), krow(CUTOFF, "0.8620", 0)], CUTOFF) })
      .on(/coinbase.*APT-USD/, { body: coinbase([[CUTOFF - 60, "0.8571", "392.765"], [CUTOFF - 120, "0.8576", "10"]]) });
    const result = await resolveCutoffPrice(deps(http, clock), rosterAsset("APT"), CUTOFF, noUsdt);
    expect(result.attempts.map((a) => [a.step, a.outcome])).toEqual([[1, "empty"], [2, "trades"]]);
    expect(result.price).toMatchObject({ venue: "coinbase", step: 2, close: "0.8571", priceE8: "85710000", tradeEvidence: "392.765" });
  });

  it("uses Bybit with the cutoff's USDT/USD price for an asset Coinbase does not list", async () => {
    const clock = new FakeClock((CUTOFF + 8) * 1000);
    const http = new FakeHttp()
      .on(/kraken.*TRXUSD/, { body: kraken([krow(CUTOFF - 60, "0.3310", 0), krow(CUTOFF, "0.3310", 0)], CUTOFF) })
      .on(/kraken.*USDTZUSD/, { body: kraken([krow(CUTOFF - 60, "0.99985", 12), krow(CUTOFF, "0.99985", 1)], CUTOFF) })
      .on(/bybit.*TRXUSDT/, { body: bybit([[CUTOFF, "0.3311", "5"], [CUTOFF - 60, "0.331", "2381.2"]]) });
    const d = deps(http, clock);
    let usdt: Promise<UsdtResolution> | null = null;
    const once = () => (usdt ??= resolveUsdtUsd(d, CUTOFF));
    const result = await resolveCutoffPrice(d, rosterAsset("TRX"), CUTOFF, once);
    expect(result.attempts.map((a) => [a.step, a.venue, a.outcome])).toEqual([[1, "kraken", "empty"], [2, "coinbase", "not-listed"], [3, "bybit", "trades"]]);
    expect(result.price).toMatchObject({ venue: "bybit", step: 3, close: "0.331", usdtUsd: "0.99985", priceE8: "33095035", tradeAgeMinutes: 0 });
    expect(result.price!.usdtEvidence?.request).toMatch(/USDTZUSD/);
    expect(http.calls.some((url) => url.includes("coinbase"))).toBe(false);
  });

  it("carries Kraken's last trade with its age when no venue traded, and rejects it beyond 30 minutes", async () => {
    const clock = new FakeClock((CUTOFF + 8) * 1000);
    const http = new FakeHttp()
      .on(/kraken.*since/, { body: kraken([krow(CUTOFF - 60, "0.50", 0), krow(CUTOFF, "0.50", 0)], CUTOFF) })
      .on(/kraken.*TAOUSD&interval=1$/, { body: kraken([krow(CUTOFF - 300, "312.4", 2), krow(CUTOFF - 240, "312.4", 0), krow(CUTOFF - 60, "312.4", 0)], CUTOFF) })
      .on(/coinbase/, { body: "[]" });
    const result = await resolveCutoffPrice(deps(http, clock), rosterAsset("TAO"), CUTOFF, noUsdt);
    expect(result.attempts.map((a) => [a.step, a.venue, a.outcome])).toEqual([[1, "kraken", "empty"], [2, "coinbase", "empty"], [3, "bybit", "not-listed"], [4, "kraken", "trades"]]);
    expect(result.price).toMatchObject({ step: 4, candleStart: CUTOFF - 300, close: "312.4", tradeAgeMinutes: 4, rejection: null });

    const stale = new FakeHttp()
      .on(/kraken.*since/, { body: kraken([krow(CUTOFF - 60, "0.50", 0)], CUTOFF) })
      .on(/kraken.*RENDERUSD&interval=1$/, { body: kraken([krow(CUTOFF - 60 * 40, "4.2", 1), krow(CUTOFF - 60, "4.2", 0)], CUTOFF) })
      .on(/coinbase/, { body: "[]" });
    const old = await resolveCutoffPrice(deps(stale, clock, { bybit: false }), rosterAsset("RENDER"), CUTOFF, noUsdt);
    expect(old.attempts.find((a) => a.step === 3)).toMatchObject({ outcome: "unavailable", detail: "Bybit is disabled by configuration" });
    expect(old.price).toMatchObject({ step: 4, tradeAgeMinutes: 39, rejection: "trade_age_exceeded" });
  });

  it("records a rate-limited venue as such and keeps walking the chain", async () => {
    const clock = new FakeClock((CUTOFF + 25) * 1000);
    const http = new FakeHttp()
      .on(/kraken.*USDTZUSD/, { body: kraken([krow(CUTOFF - 60, "1.0001", 4), krow(CUTOFF, "1.0001", 1)], CUTOFF) })
      .on(/kraken.*since/, { body: kraken([krow(CUTOFF - 60, "1.25", 0), krow(CUTOFF, "1.25", 0)], CUTOFF) })
      .on(/coinbase/, { status: 429, body: "{}", headers: { "retry-after": "30" } })
      .on(/bybit.*OPUSDT/, { body: bybit([[CUTOFF, "1.26", "1"], [CUTOFF - 60, "1.25", "100"]]) });
    const d = deps(http, clock);
    const result = await resolveCutoffPrice(d, rosterAsset("OP"), CUTOFF, () => resolveUsdtUsd(d, CUTOFF));
    expect(result.attempts.map((a) => [a.step, a.outcome])).toEqual([[1, "empty"], [2, "rate-limited"], [3, "trades"]]);
    expect(result.price).toMatchObject({ venue: "bybit", priceE8: "125012500" });
  });

  it("keeps a close with more than eight decimals as an inadmissible observation", async () => {
    const clock = new FakeClock((CUTOFF + 8) * 1000);
    const http = new FakeHttp().on(/kraken/, { body: kraken([krow(CUTOFF - 60, "0.000012345", 5)], CUTOFF) });
    const result = await resolveCutoffPrice(deps(http, clock), rosterAsset("W"), CUTOFF, noUsdt);
    expect(result.price).toMatchObject({ close: "0.000012345", priceE8: null, rejection: "excess_decimals" });
  });

  it("refuses a cutoff that is not a minute boundary", async () => {
    const clock = new FakeClock(0);
    await expect(resolveCutoffPrice(deps(new FakeHttp(), clock), rosterAsset("BTC"), CUTOFF + 1, noUsdt)).rejects.toThrow(/invalid cutoff/);
  });
});
