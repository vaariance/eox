import { describe, expect, it } from "vitest";
import type { ArchiveVenue, ArchivedCutoff } from "../src/archive.js";
import type { EvidenceSource } from "../src/evidence-source.js";
import { ArchiveMonitor, emptyMonitorState } from "../src/monitor.js";
import { type CandleSource, type VenueCandle, checkAgainstVenues } from "../src/venue-check.js";
import { snapshotDigest } from "../src/wire.js";

const CUTOFF = 1_791_600_000;
const START = CUTOFF - 60;

function candle(start: number, close: string, hasTrades = true, final = true): VenueCandle {
  return { start, close, hasTrades, final };
}

class Venues implements CandleSource {
  readonly calls: string[] = [];
  private readonly books = new Map<string, VenueCandle[] | "not-listed">();

  set(venue: ArchiveVenue, assetId: string, candles: VenueCandle[] | "not-listed"): this {
    this.books.set(`${venue}|${assetId}`, candles);
    return this;
  }

  async candles(venue: ArchiveVenue, assetId: string, from: number, to: number) {
    this.calls.push(`${venue} ${assetId} ${from} ${to}`);
    const book = this.books.get(`${venue}|${assetId}`) ?? [];
    return book === "not-listed" ? book : book.filter((item) => item.start >= from && item.start < to);
  }
}

function archived(cutoff = CUTOFF): ArchivedCutoff {
  const start = cutoff - 60;
  return {
    cutoff,
    snapshot: { digest: null, digestEncoding: "COX/WIRE/V1", admissible: true },
    assets: [
      {
        assetId: "BTC",
        position: 0,
        attempts: [{ step: 1, venue: "kraken", outcome: "trades", artifactDigest: null }],
        price: { venue: "kraken", step: 1, candleStart: start, close: "100.50", usdtUsd: null, usdtArtifactDigest: null, priceE8: "10050000000", tradeAgeMinutes: 0, artifactDigest: "a", admissible: true, rejection: null },
      },
      {
        assetId: "RENDER",
        position: 1,
        attempts: [
          { step: 1, venue: "kraken", outcome: "empty", artifactDigest: null },
          { step: 2, venue: "coinbase", outcome: "trades", artifactDigest: null },
        ],
        price: { venue: "coinbase", step: 2, candleStart: start, close: "3.61", usdtUsd: null, usdtArtifactDigest: null, priceE8: "361000000", tradeAgeMinutes: 0, artifactDigest: "b", admissible: true, rejection: null },
      },
      {
        assetId: "JUP",
        position: 2,
        attempts: [
          { step: 1, venue: "kraken", outcome: "empty", artifactDigest: null },
          { step: 2, venue: "coinbase", outcome: "not-listed", artifactDigest: null },
          { step: 3, venue: "bybit", outcome: "trades", artifactDigest: null },
        ],
        price: { venue: "bybit", step: 3, candleStart: start, close: "0.4480", usdtUsd: "0.9998", usdtArtifactDigest: "u", priceE8: "44791040", tradeAgeMinutes: 0, artifactDigest: "c", admissible: true, rejection: null },
      },
      {
        assetId: "TAO",
        position: 3,
        attempts: [
          { step: 1, venue: "kraken", outcome: "empty", artifactDigest: null },
          { step: 2, venue: "coinbase", outcome: "unavailable", artifactDigest: null },
          { step: 4, venue: "kraken", outcome: "trades", artifactDigest: null },
        ],
        price: { venue: "kraken", step: 4, candleStart: start - 180, close: "318.2", usdtUsd: null, usdtArtifactDigest: null, priceE8: "31820000000", tradeAgeMinutes: 3, artifactDigest: "d", admissible: true, rejection: null },
      },
    ],
    usdtUsd: { attempts: [{ step: 1, venue: "kraken", outcome: "trades", artifactDigest: "u" }] },
  };
}

function honest(cutoff = CUTOFF): Venues {
  const start = cutoff - 60;
  return new Venues()
    .set("kraken", "BTC", [candle(start, "100.5")])
    .set("kraken", "RENDER", [candle(start, "3.60", false)])
    .set("coinbase", "RENDER", [candle(start, "3.61000")])
    .set("kraken", "JUP", [])
    .set("bybit", "JUP", [candle(start, "0.448")])
    .set("kraken", "USDT", [candle(start, "0.99980")])
    .set("kraken", "TAO", [candle(start - 180, "318.20"), candle(start - 120, "318.2", false), candle(start - 60, "318.2", false), candle(start, "318.2", false)]);
}

const check = async (venues: CandleSource, view = archived()) => (await checkAgainstVenues([view], venues)).get(view.cutoff)!;

describe("venue re-fetch", () => {
  it("confirms an archive whose closes and empty minutes match the venues, ignoring number formatting", async () => {
    expect(await check(honest())).toEqual({ findings: [], unverified: [] });
  });

  it("asks each venue once per asset, and never asks a venue the archive could not reach", async () => {
    const venues = honest();
    await check(venues);
    expect(venues.calls.sort()).toEqual(
      [
        `bybit JUP ${START} ${CUTOFF}`,
        `coinbase RENDER ${START} ${CUTOFF}`,
        `kraken BTC ${START} ${CUTOFF}`,
        `kraken JUP ${START} ${CUTOFF}`,
        `kraken RENDER ${START} ${CUTOFF}`,
        `kraken TAO ${START - 180} ${CUTOFF}`,
        `kraken USDT ${START} ${CUTOFF}`,
      ].sort(),
    );
  });

  it("reports a close that differs from the venue", async () => {
    const result = await check(honest().set("kraken", "BTC", [candle(START, "100.51")]));
    expect(result.findings).toEqual([`BTC on kraken candle ${START} closed at 100.51 at the venue, not the archived 100.50`]);
  });

  it("reports a fallback taken although the earlier venue did trade", async () => {
    const result = await check(honest().set("kraken", "RENDER", [candle(START, "3.60")]));
    expect(result.findings).toEqual([`RENDER on kraken candle ${START} has trades at the venue but the archive recorded none`]);
  });

  it("reports a carried close that was not the last Kraken trade", async () => {
    const venues = honest().set("kraken", "TAO", [candle(START - 180, "318.2"), candle(START - 120, "319", true), candle(START - 60, "319", false), candle(START, "319", false)]);
    expect((await check(venues)).findings).toEqual([`TAO on kraken candle ${START - 120} has trades at the venue but the archive recorded none`]);
  });

  it("reports a used close from a minute the venue says had no trades, and an unlisted market", async () => {
    const empty = await check(honest().set("coinbase", "RENDER", [candle(START, "3.61", false)]));
    expect(empty.findings).toEqual([`RENDER on coinbase candle ${START} has no trades at the venue but the archive used its close`]);
    const unlisted = await check(honest().set("bybit", "JUP", "not-listed"));
    expect(unlisted.findings).toEqual(["JUP on bybit is not listed at the venue but the archive used its close"]);
  });

  it("reports a USDT/USD rate that is not the venue's cutoff close", async () => {
    const result = await check(honest().set("kraken", "USDT", [candle(START, "0.9997")]));
    expect(result.findings).toEqual([`USDT/USD on kraken candle ${START} closed at 0.9997 at the venue, not the archived 0.9998`]);
  });

  it("marks a candle the venue no longer returns, or has not finalised, as unverified rather than wrong", async () => {
    const gone = await check(honest().set("kraken", "BTC", []));
    expect(gone).toEqual({ findings: [], unverified: [`BTC on kraken candle ${START} is no longer returned by the venue`] });
    const open = await check(honest().set("kraken", "BTC", [candle(START, "100.5", true, false)]));
    expect(open).toEqual({ findings: [], unverified: [`BTC on kraken candle ${START} is not final at the venue yet`] });
  });

  it("covers many cutoffs with one request per venue and asset", async () => {
    const views = [0, 1, 2].map((index) => archived(CUTOFF + index * 60));
    for (const view of views) view.assets = view.assets.slice(0, 1);
    const venues = new Venues().set("kraken", "BTC", views.map((view) => candle(view.cutoff - 60, "100.5")));
    const results = await checkAgainstVenues(views, venues);
    expect(venues.calls).toEqual([`kraken BTC ${START} ${CUTOFF + 120}`]);
    expect([...results.values()].every((result) => result.findings.length === 0 && result.unverified.length === 0)).toBe(true);
  });
});

describe("venue sweep in the monitor", () => {
  function setup(venues: Venues, nowSeconds: number) {
    const view = archived();
    view.assets = view.assets.slice(0, 1);
    view.assets[0]!.price!.close = "100";
    view.assets[0]!.price!.priceE8 = "10000000000";
    view.snapshot.digest = snapshotDigest(BigInt(CUTOFF), ["BTC", "ETH"], [
      { assetId: "BTC", venue: 0, step: 1, candleStart: BigInt(START), priceE8: 10_000_000_000n, tradeAgeMinutes: 0 },
      { assetId: "ETH", venue: 0, step: 1, candleStart: BigInt(START), priceE8: 20_000_000_000n, tradeAgeMinutes: 0 },
    ]);
    view.assets.push({
      assetId: "ETH",
      position: 1,
      attempts: [{ step: 1, venue: "kraken", outcome: "trades", artifactDigest: null }],
      price: { venue: "kraken", step: 1, candleStart: START, close: "200", usdtUsd: null, usdtArtifactDigest: null, priceE8: "20000000000", tradeAgeMinutes: 0, artifactDigest: "e", admissible: true, rejection: null },
    });
    const source: EvidenceSource = {
      changes: async (after) => ({ after: "1", cutoffs: after === null ? [{ cutoff: CUTOFF, admissible: true, snapshotDigest: view.snapshot.digest }] : [] }),
      cutoff: async () => view,
      hasArtifact: async () => true,
    };
    const monitor = new ArchiveMonitor({ source, state: emptyMonitorState(), save: async () => undefined, now: () => nowSeconds * 1000 });
    return { monitor, venues: venues.set("kraken", "ETH", [candle(START, "200")]) };
  }

  it("waits for the minute to settle, then confirms a matching cutoff once", async () => {
    const early = setup(new Venues().set("kraken", "BTC", [candle(START, "100")]), CUTOFF + 30);
    await early.monitor.tick();
    expect(await early.monitor.sweepVenues(early.venues)).toEqual({ confirmed: 0, mismatches: 0, unverified: 0 });
    expect(early.monitor.find(CUTOFF)!.venues).toBe("pending");

    const later = setup(new Venues().set("kraken", "BTC", [candle(START, "100")]), CUTOFF + 600);
    await later.monitor.tick();
    expect(await later.monitor.sweepVenues(later.venues)).toEqual({ confirmed: 1, mismatches: 0, unverified: 0 });
    expect(later.monitor.find(CUTOFF)!.venues).toBe("confirmed");
    expect(await later.monitor.sweepVenues(later.venues)).toEqual({ confirmed: 0, mismatches: 0, unverified: 0 });
  });

  it("turns a matching archive verdict into a mismatch when a venue disagrees", async () => {
    const { monitor, venues } = setup(new Venues().set("kraken", "BTC", [candle(START, "101")]), CUTOFF + 600);
    await monitor.tick();
    expect(monitor.find(CUTOFF)!.verdict).toBe("match");
    expect(await monitor.sweepVenues(venues)).toEqual({ confirmed: 0, mismatches: 1, unverified: 0 });
    const verdict = monitor.find(CUTOFF)!;
    expect(verdict.verdict).toBe("mismatch");
    expect(verdict.venues).toBe("mismatch");
    expect(verdict.findings).toEqual([`venue: BTC on kraken candle ${START} closed at 101 at the venue, not the archived 100`]);
    expect(monitor.state.mismatches).toBe(1);
  });

  it("records a cutoff the venues can no longer show as unverified, not as a mismatch", async () => {
    const { monitor, venues } = setup(new Venues(), CUTOFF + 600);
    await monitor.tick();
    expect(await monitor.sweepVenues(venues)).toEqual({ confirmed: 0, mismatches: 0, unverified: 1 });
    expect(monitor.find(CUTOFF)!.verdict).toBe("match");
    expect(monitor.find(CUTOFF)!.venues).toBe("unverified");
  });
});
