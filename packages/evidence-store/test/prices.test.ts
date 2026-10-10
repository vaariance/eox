import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getAssets,
  getCutoff,
  getLatestSnapshotCutoff,
  pool,
  readSnapshotChanges,
  recordAssetResolution,
  recordIncident,
  recordSnapshot,
  recordSourcePayload,
  recordVenueResponse,
  registerAsset,
  type ChangeCursor,
  type NewPriceObservation,
  type Venue,
} from "../src/index.js";

const BTC = { assetId: "BTC", position: 0, krakenWsSymbol: "BTC/USD", krakenRestPair: "XXBTZUSD", coinbaseProduct: "BTC-USD", bybitSymbol: "BTCUSDT" };
const TRX = { assetId: "TRX", position: 5, krakenWsSymbol: "TRX/USD", krakenRestPair: "TRXUSD", coinbaseProduct: null, bybitSymbol: "TRXUSDT" };

let payloadCounter = 0;
async function payload(venue: Venue = "kraken"): Promise<string> {
  payloadCounter += 1;
  const stored = await recordSourcePayload({
    sourceId: venue,
    requestUrl: `https://example.test/${venue}`,
    httpStatus: 200,
    contentType: "application/json",
    body: new TextEncoder().encode(`{"test":${payloadCounter},"at":${Date.now()}}`),
  });
  return stored.sha256;
}

let cutoffCounter = 0;
const nextCutoff = () => 1_800_000_000 + 60 * ++cutoffCounter;

async function krakenTrade(cutoff: number, overrides: Partial<NewPriceObservation> = {}): Promise<NewPriceObservation> {
  return {
    venue: "kraken",
    step: 1,
    candleStart: cutoff - 60,
    close: "82758.6",
    usdtUsd: null,
    usdtRawSha256: null,
    priceE8: "8275860000000",
    tradeEvidence: "80",
    tradeAgeMinutes: 0,
    rawSha256: await payload(),
    rejection: null,
    ...overrides,
  };
}

beforeAll(async () => {
  await registerAsset(BTC);
  await registerAsset(TRX);
});

afterAll(async () => {
  await pool.end();
});

describe("assets", () => {
  it("registers the roster in canonical order and refuses a conflicting identity", async () => {
    expect(await registerAsset(BTC)).toMatchObject(BTC);
    await expect(registerAsset({ ...BTC, position: 1 })).rejects.toThrow(/conflicts/);
    await expect(registerAsset({ ...BTC, coinbaseProduct: null })).rejects.toThrow(/conflicts/);
    const assets = await getAssets();
    expect(assets.map((a) => a.assetId).slice(0, 2)).toEqual(["BTC", "TRX"]);
  });

  it("rejects malformed venue symbols and USDT as a roster asset", async () => {
    await expect(registerAsset({ ...BTC, assetId: "BAD", position: 90, krakenWsSymbol: "btc-usd" })).rejects.toThrow();
    await expect(registerAsset({ ...TRX, assetId: "USDT", position: 91, krakenWsSymbol: "USDT/USD", krakenRestPair: "USDTZUSD", bybitSymbol: null })).rejects.toThrow();
  });
});

describe("asset resolution", () => {
  it("stores every fallback attempt and the chosen price exactly as given", async () => {
    const cutoff = nextCutoff();
    const kraken = await payload("kraken");
    const bybit = await payload("bybit");
    const usdt = await payload("kraken");
    await recordVenueResponse({ venue: "kraken", assetId: "TRX", cutoff, request: "ws ohlc TRX/USD", rawSha256: kraken });
    await recordVenueResponse({ venue: "bybit", assetId: "TRX", cutoff, request: "GET /v5/market/kline TRXUSDT", rawSha256: bybit });
    await recordVenueResponse({ venue: "kraken", assetId: "USDT", cutoff, request: "ws ohlc USDT/USD", rawSha256: usdt });
    const result = await recordAssetResolution({
      assetId: "TRX",
      cutoff,
      attempts: [
        { venue: "kraken", step: 1, outcome: "empty", rawSha256: kraken },
        { venue: "coinbase", step: 2, outcome: "not-listed", rawSha256: null },
        { venue: "bybit", step: 3, outcome: "trades", rawSha256: bybit },
      ],
      observation: await krakenTrade(cutoff, {
        venue: "bybit", step: 3, close: "0.331", usdtUsd: "0.99985", usdtRawSha256: usdt, priceE8: "33095035",
        tradeEvidence: "2381.2", rawSha256: bybit,
      }),
    });
    expect(result.attempts.map((a) => [a.step, a.venue, a.outcome])).toEqual([[1, "kraken", "empty"], [2, "coinbase", "not-listed"], [3, "bybit", "trades"]]);
    const record = await getCutoff(cutoff);
    expect(record.observations).toHaveLength(1);
    expect(record.observations[0]).toMatchObject({ assetId: "TRX", venue: "bybit", step: 3, close: "0.331", usdtUsd: "0.99985", priceE8: "33095035", tradeAgeMinutes: 0, admissible: true });
    expect(record.responses.map((r) => r.assetId)).toEqual(["TRX", "TRX", "USDT"]);
    expect(record.attempts).toHaveLength(3);
  });

  it("records a carried Kraken close with its trade age and rejects inconsistent ages", async () => {
    const cutoff = nextCutoff();
    const stored = await recordAssetResolution({
      assetId: "BTC",
      cutoff,
      attempts: [{ venue: "kraken", step: 4, outcome: "trades", rawSha256: null }],
      observation: await krakenTrade(cutoff, { step: 4, candleStart: cutoff - 60 * 4, tradeAgeMinutes: 3 }),
    });
    expect(stored.observation).toMatchObject({ step: 4, tradeAgeMinutes: 3, candleStart: cutoff - 240 });
    for (const bad of [
      { step: 4 as const, candleStart: cutoff - 240, tradeAgeMinutes: 2 },
      { step: 1 as const, candleStart: cutoff - 120, tradeAgeMinutes: 1 },
      { step: 4 as const, candleStart: cutoff - 240, tradeAgeMinutes: 3, venue: "coinbase" as const },
      { venue: "bybit" as const, step: 3 as const },
    ]) {
      const c = nextCutoff();
      const shifted = "candleStart" in bad && bad.candleStart !== undefined ? { ...bad, candleStart: bad.candleStart - cutoff + c } : bad;
      await expect(recordAssetResolution({ assetId: "BTC", cutoff: c, attempts: [], observation: await krakenTrade(c, shifted) }), JSON.stringify(bad)).rejects.toThrow();
    }
  });

  it("writes nothing when any part of a resolution is invalid", async () => {
    const cutoff = nextCutoff();
    await expect(
      recordAssetResolution({
        assetId: "BTC",
        cutoff,
        attempts: [{ venue: "kraken", step: 1, outcome: "trades", rawSha256: null }],
        observation: await krakenTrade(cutoff, { close: "1,5" }),
      }),
    ).rejects.toThrow();
    const record = await getCutoff(cutoff);
    expect(record.attempts).toEqual([]);
    expect(record.observations).toEqual([]);
  });

  it("keeps a rejected price with its reason and never an admissible one without a price", async () => {
    const cutoff = nextCutoff();
    const stored = await recordAssetResolution({
      assetId: "BTC",
      cutoff,
      attempts: [{ venue: "kraken", step: 1, outcome: "trades", rawSha256: null }],
      observation: await krakenTrade(cutoff, { close: "0.000000001", priceE8: null, rejection: "excess_decimals" }),
    });
    expect(stored.observation).toMatchObject({ admissible: false, rejection: "excess_decimals", priceE8: null });
    const c = nextCutoff();
    await expect(recordAssetResolution({ assetId: "BTC", cutoff: c, attempts: [], observation: await krakenTrade(c, { priceE8: null }) })).rejects.toThrow();
  });
});

describe("snapshots", () => {
  async function resolveBoth(cutoff: number, btc: Partial<NewPriceObservation> = {}) {
    const a = await recordAssetResolution({ assetId: "BTC", cutoff, attempts: [], observation: await krakenTrade(cutoff, btc) });
    const b = await recordAssetResolution({ assetId: "TRX", cutoff, attempts: [], observation: await krakenTrade(cutoff, { close: "0.331", priceE8: "33100000" }) });
    return [a.observation!.id, b.observation!.id];
  }

  it("binds the cutoff's observations in canonical order", async () => {
    const cutoff = nextCutoff();
    const [btc, trx] = await resolveBoth(cutoff);
    await expect(recordSnapshot({ cutoff, observationIds: [trx!, btc!], snapshotDigest: "a".repeat(64), admissible: true })).rejects.toThrow(/canonical asset order/);
    await expect(recordSnapshot({ cutoff, observationIds: [btc!, btc!], snapshotDigest: "a".repeat(64), admissible: true })).rejects.toThrow(/distinct/);
    const snapshot = await recordSnapshot({ cutoff, observationIds: [btc!, trx!], snapshotDigest: "a".repeat(64), admissible: true });
    expect(snapshot).toMatchObject({ cutoff, observationIds: [btc, trx], admissible: true });
    expect(await getLatestSnapshotCutoff()).toBeGreaterThanOrEqual(cutoff);
    await expect(recordSnapshot({ cutoff, observationIds: [btc!], snapshotDigest: "b".repeat(64), admissible: false })).rejects.toThrow();
  });

  it("refuses observations from another cutoff and an admissible snapshot with a rejected price", async () => {
    const first = nextCutoff();
    const [btcFirst] = await resolveBoth(first);
    const second = nextCutoff();
    const [btc, trx] = await resolveBoth(second, { close: "-1", priceE8: "-100000000", rejection: "non_positive_price" });
    await expect(recordSnapshot({ cutoff: second, observationIds: [btcFirst!, trx!], snapshotDigest: "c".repeat(64), admissible: false })).rejects.toThrow(/distinct observations of its cutoff/);
    await expect(recordSnapshot({ cutoff: second, observationIds: [btc!, trx!], snapshotDigest: "c".repeat(64), admissible: true })).rejects.toThrow(/inadmissible observation/);
    expect(await recordSnapshot({ cutoff: second, observationIds: [btc!, trx!], snapshotDigest: "c".repeat(64), admissible: false })).toMatchObject({ admissible: false });
  });

  it("feeds every committed snapshot once, in commit order, from a resumable cursor", async () => {
    let cursor: ChangeCursor | null = null;
    for (;;) {
      const page = await readSnapshotChanges(cursor, 100);
      if (page.snapshots.length === 0) break;
      cursor = page.cursor;
    }
    const cutoffs = [nextCutoff(), nextCutoff()];
    for (const cutoff of cutoffs) {
      const ids = await resolveBoth(cutoff);
      await recordSnapshot({ cutoff, observationIds: ids, snapshotDigest: "d".repeat(64), admissible: true });
    }
    const seen: number[] = [];
    for (;;) {
      const page = await readSnapshotChanges(cursor, 1);
      if (page.snapshots.length === 0) break;
      seen.push(...page.snapshots.map((s) => s.cutoff));
      cursor = page.cursor;
    }
    expect(seen).toEqual(cutoffs);
  });
});

describe("incidents and immutability", () => {
  it("records incidents with their venue, asset and response", async () => {
    const cutoff = nextCutoff();
    const raw = await payload("coinbase");
    await recordIncident({ cutoff, kind: "venue_rate_limited", assetId: "BTC", venue: "coinbase", detail: "HTTP 429", rawSha256: raw });
    await recordIncident({ cutoff, kind: "snapshot_inadmissible", assetId: null, venue: null, detail: "TAO trade age 31 minutes", rawSha256: null });
    expect((await getCutoff(cutoff)).incidents.map((i) => [i.kind, i.venue, i.rawSha256])).toEqual([
      ["venue_rate_limited", "coinbase", raw],
      ["snapshot_inadmissible", null, null],
    ]);
    await expect(recordIncident({ cutoff, kind: "guess" as never, assetId: null, venue: null, detail: "x", rawSha256: null })).rejects.toThrow();
  });

  it("is append-only", async () => {
    for (const sql of [
      "UPDATE price_observations SET close = '1'",
      "DELETE FROM venue_attempts",
      "UPDATE snapshots SET admissible = true",
      "DELETE FROM assets WHERE asset_id = 'BTC'",
      "TRUNCATE venue_responses",
      "TRUNCATE incidents",
    ]) {
      await expect(pool.query(sql), sql).rejects.toThrow(/append-only/);
    }
  });
});
