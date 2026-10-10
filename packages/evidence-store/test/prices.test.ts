import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getAssets,
  getIncidents,
  getLatestPriceCutoff,
  getPriceUpdate,
  pool,
  readPriceChanges,
  recordIncident,
  recordPriceUpdate,
  recordSourcePayload,
  registerAsset,
  type ChangeCursor,
  type NewPriceObservation,
} from "../src/index.js";

const BTC = { assetId: "BTC", feedId: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", symbol: "Crypto.BTC/USD", quote: "USD" };
const ETH = { assetId: "ETH", feedId: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", symbol: "Crypto.ETH/USD", quote: "USD" };

let payloadCounter = 0;
async function payload(): Promise<string> {
  payloadCounter += 1;
  const stored = await recordSourcePayload({
    sourceId: "pyth-hermes",
    requestUrl: "https://pyth.dourolabs.app/hermes/v2/updates/price/1",
    httpStatus: 200,
    contentType: "application/json",
    body: new TextEncoder().encode(`{"test":${payloadCounter},"at":${Date.now()}}`),
  });
  return stored.sha256;
}

let cutoffCounter = 0;
const nextCutoff = () => 1_800_000_000 + 60 * ++cutoffCounter;

const observation = (asset: typeof BTC, overrides: Partial<NewPriceObservation> = {}): NewPriceObservation => ({
  assetId: asset.assetId,
  feedId: asset.feedId,
  price: "6123456789012",
  conf: "2345678",
  expo: -8,
  publishTime: 0,
  prevPublishTime: 0,
  rejection: null,
  ...overrides,
});

beforeAll(async () => {
  await registerAsset(BTC);
  await registerAsset(ETH);
});

afterAll(async () => {
  await pool.end();
});

describe("assets", () => {
  it("registers an asset by id and feed and refuses a conflicting identity", async () => {
    expect(await registerAsset(BTC)).toMatchObject(BTC);
    await expect(registerAsset({ ...BTC, feedId: ETH.feedId })).rejects.toThrow(/different identity/);
    await expect(registerAsset({ ...BTC, symbol: "BTC" })).rejects.toThrow(/different identity/);
    expect((await getAssets()).map((asset) => asset.assetId)).toEqual(expect.arrayContaining(["BTC", "ETH"]));
  });

  it("rejects malformed feed ids", async () => {
    await expect(registerAsset({ ...BTC, assetId: "BAD", feedId: "0xE62D" })).rejects.toThrow();
  });
});

describe("price updates", () => {
  it("stores one update per cutoff with its observations exactly as given", async () => {
    const cutoff = nextCutoff();
    const raw = await payload();
    const stored = await recordPriceUpdate({
      cutoff,
      rawSha256: raw,
      feedIds: [BTC.feedId, ETH.feedId],
      observations: [
        observation(BTC, { publishTime: cutoff + 1, prevPublishTime: cutoff }),
        observation(ETH, { price: "-1", publishTime: cutoff + 2, prevPublishTime: cutoff, rejection: "non_positive_price" }),
      ],
    });
    expect(stored.observations).toHaveLength(2);
    const read = await getPriceUpdate(cutoff);
    expect(read).toMatchObject({ cutoff, rawSha256: raw, feedIds: [BTC.feedId, ETH.feedId] });
    expect(read!.observations.map((o) => [o.assetId, o.price, o.conf, o.expo, o.publishTime, o.admissible, o.rejection])).toEqual([
      ["BTC", "6123456789012", "2345678", -8, cutoff + 1, true, null],
      ["ETH", "-1", "2345678", -8, cutoff + 2, false, "non_positive_price"],
    ]);
    expect(await getLatestPriceCutoff()).toBeGreaterThanOrEqual(cutoff);
    await expect(recordPriceUpdate({ cutoff, rawSha256: await payload(), feedIds: [BTC.feedId], observations: [] })).rejects.toThrow();
  });

  it("writes nothing when any observation is invalid", async () => {
    const cutoff = nextCutoff();
    const raw = await payload();
    await expect(
      recordPriceUpdate({
        cutoff,
        rawSha256: raw,
        feedIds: [BTC.feedId],
        observations: [observation(BTC, { publishTime: cutoff }), observation(ETH, { publishTime: cutoff })],
      }),
    ).rejects.toThrow(/does not match its price update/);
    expect(await getPriceUpdate(cutoff)).toBeNull();
  });

  it("rejects cutoffs off the minute, non-integer prices and a rejection that disagrees with admissibility", async () => {
    const raw = await payload();
    await expect(recordPriceUpdate({ cutoff: 1_800_000_001, rawSha256: raw, feedIds: [BTC.feedId], observations: [] })).rejects.toThrow();
    for (const bad of [{ price: "1.5" }, { price: "01" }, { conf: "-1" }, { rejection: "stale" as never }]) {
      const cutoff = nextCutoff();
      await expect(
        recordPriceUpdate({ cutoff, rawSha256: raw, feedIds: [BTC.feedId], observations: [observation(BTC, { publishTime: cutoff, ...bad })] }),
      ).rejects.toThrow();
    }
  });

  it("is append-only", async () => {
    const cutoff = nextCutoff();
    await recordPriceUpdate({ cutoff, rawSha256: await payload(), feedIds: [BTC.feedId], observations: [observation(BTC, { publishTime: cutoff })] });
    for (const sql of [
      `UPDATE price_observations SET price = '1' WHERE cutoff = ${cutoff}`,
      `DELETE FROM price_observations WHERE cutoff = ${cutoff}`,
      `UPDATE price_updates SET feed_ids = '{}' WHERE cutoff = ${cutoff}`,
      `DELETE FROM assets WHERE asset_id = 'BTC'`,
      `TRUNCATE incidents`,
    ]) {
      await expect(pool.query(sql), sql).rejects.toThrow(/append-only/);
    }
  });
});

describe("incidents", () => {
  it("records incidents with or without the response that caused them", async () => {
    const cutoff = nextCutoff();
    const raw = await payload();
    await recordIncident({ cutoff, kind: "fetch_failed", detail: "HTTP 503 from Hermes", rawSha256: null });
    await recordIncident({ cutoff, kind: "missing_feed", detail: `feed ${ETH.feedId} absent`, rawSha256: raw });
    expect((await getIncidents(cutoff)).map((i) => [i.kind, i.rawSha256])).toEqual([
      ["fetch_failed", null],
      ["missing_feed", raw],
    ]);
    await expect(recordIncident({ cutoff, kind: "guess" as never, detail: "x", rawSha256: null })).rejects.toThrow();
  });
});

describe("price change feed", () => {
  it("returns every committed observation once, in commit order, and resumes from its cursor", async () => {
    let cursor: ChangeCursor | null = null;
    for (;;) {
      const page = await readPriceChanges(cursor, 100);
      if (page.observations.length === 0) break;
      cursor = page.cursor;
    }
    const cutoffs = [nextCutoff(), nextCutoff()];
    for (const cutoff of cutoffs) {
      await recordPriceUpdate({
        cutoff,
        rawSha256: await payload(),
        feedIds: [BTC.feedId, ETH.feedId],
        observations: [observation(BTC, { publishTime: cutoff }), observation(ETH, { publishTime: cutoff })],
      });
    }
    const seen: string[] = [];
    for (;;) {
      const page = await readPriceChanges(cursor, 1);
      if (page.observations.length === 0) break;
      seen.push(...page.observations.map((o) => `${o.cutoff}/${o.assetId}`));
      cursor = page.cursor;
    }
    expect(seen).toEqual(cutoffs.flatMap((cutoff) => [`${cutoff}/BTC`, `${cutoff}/ETH`]));
  });
});
