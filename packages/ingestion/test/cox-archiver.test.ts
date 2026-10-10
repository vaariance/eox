import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCutoff, pool, readSnapshotChanges, registerAsset } from "@eox/evidence-store";
import { ROSTER, VenueClient, type ResolverDeps } from "@eox/price-feeds";
import { archiveCutoff } from "../src/cox/archive-cutoff.js";
import { snapshotDigest } from "../src/cox/digest.js";
import { feedCheck, renderFeedCheck } from "../src/cox/feed-check.js";

const BASE = 1_900_000_000 - (1_900_000_000 % 60);
const krow = (start: number, close: string, count: number) => `[${start},"${close}","${close}","${close}","${close}","${close}","1.0",${count}]`;

type Script = (url: string, cutoff: number) => { status?: number; body: string } | null;

function deps(script: Script, cutoff: number, nowSeconds: number): ResolverDeps {
  const fetchFake = (async (input: string | URL | Request) => {
    const reply = script(String(input), cutoff);
    if (!reply) throw new Error(`unexpected request ${String(input)}`);
    return new Response(reply.body, { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const clock = { ms: nowSeconds * 1000 };
  const client = (venue: "kraken" | "coinbase" | "bybit") =>
    new VenueClient(venue, {
      requestsPerSecond: venue === "kraken" ? 0.5 : 2,
      userAgent: "COX-test (ops@example.test)",
      fetch: fetchFake,
      now: () => clock.ms,
      sleep: async () => undefined,
    });
  return { ws: null, kraken: client("kraken"), coinbase: client("coinbase"), bybit: client("bybit"), now: () => clock.ms };
}

const everyoneTrades: Script = (url, cutoff) => {
  if (url.includes("api.kraken.com")) return { body: `{"error":[],"result":{"P":[${krow(cutoff - 60, "1.5", 3)},${krow(cutoff, "1.5", 1)}],"last":${cutoff}}}` };
  return null;
};

const thinMarket: Script = (url, cutoff) => {
  if (url.includes("USDTZUSD")) return { body: `{"error":[],"result":{"P":[${krow(cutoff - 60, "0.9999", 4)},${krow(cutoff, "0.9999", 1)}],"last":${cutoff}}}` };
  if (url.includes("pair=TRXUSD")) return { body: `{"error":[],"result":{"P":[${krow(cutoff - 60, "0.33", 0)},${krow(cutoff, "0.33", 0)}],"last":${cutoff}}}` };
  if (url.includes("api.kraken.com")) return { body: `{"error":[],"result":{"P":[${krow(cutoff - 60, "2.5", 7)},${krow(cutoff, "2.5", 1)}],"last":${cutoff}}}` };
  if (url.includes("bybit") && url.includes("TRXUSDT")) {
    return { body: `{"retCode":0,"retMsg":"OK","result":{"list":[["${cutoff * 1000}","0.331","0.331","0.331","0.331","1","1"],["${(cutoff - 60) * 1000}","0.331","0.331","0.331","0.331","2381.2","1"]]}}` };
  }
  return null;
};

beforeAll(async () => {
  for (const asset of ROSTER) await registerAsset(asset);
});

afterAll(async () => {
  await pool.end();
});

describe("COX archiver", () => {
  it("archives every asset of a cutoff with its attempts, evidence and an ordered snapshot", async () => {
    const cutoff = BASE;
    const result = await archiveCutoff(deps(everyoneTrades, cutoff, cutoff + 8), ROSTER, cutoff, () => (cutoff + 9) * 1000);
    expect(result).toMatchObject({ resolved: 30, admissible: true, late: false });
    const record = await getCutoff(cutoff);
    expect(record.observations.map((o) => o.assetId)).toEqual(ROSTER.map((a) => a.assetId));
    expect(record.observations.every((o) => o.venue === "kraken" && o.step === 1 && o.priceE8 === "150000000")).toBe(true);
    expect(record.attempts).toHaveLength(30);
    expect(record.responses).toHaveLength(30);
    expect(record.incidents).toEqual([]);
    expect(record.snapshot!.snapshotDigest).toBe(
      snapshotDigest(cutoff, ROSTER.map((a) => ({ assetId: a.assetId, venue: "kraken" as const, step: 1, candleStart: cutoff - 60, priceE8: "150000000", tradeAgeMinutes: 0 }))),
    );
    await expect(archiveCutoff(deps(everyoneTrades, cutoff, cutoff + 8), ROSTER, cutoff)).rejects.toThrow(/already archived/);
  });

  it("falls back per asset, records the USDT conversion once and keeps the snapshot admissible", async () => {
    const cutoff = BASE + 60;
    const result = await archiveCutoff(deps(thinMarket, cutoff, cutoff + 8), ROSTER, cutoff, () => (cutoff + 20) * 1000);
    expect(result.admissible).toBe(true);
    const record = await getCutoff(cutoff);
    const trx = record.observations.find((o) => o.assetId === "TRX")!;
    expect(trx).toMatchObject({ venue: "bybit", step: 3, close: "0.331", usdtUsd: "0.9999", priceE8: "33096690" });
    expect(record.attempts.filter((a) => a.assetId === "TRX").map((a) => [a.step, a.outcome])).toEqual([[1, "empty"], [2, "not-listed"], [3, "trades"]]);
    expect(record.attempts.filter((a) => a.assetId === "USDT").map((a) => [a.step, a.venue, a.outcome])).toEqual([[1, "kraken", "trades"]]);
    expect(record.responses.filter((r) => r.assetId === "USDT")).toHaveLength(1);
  });

  it("marks a late or incomplete cutoff inadmissible and says why", async () => {
    const cutoff = BASE + 120;
    const failing: Script = (url, c) => (url.includes("XXBTZUSD") || url.includes("BTC") ? { status: 503, body: "down" } : everyoneTrades(url, c));
    const result = await archiveCutoff(deps(failing, cutoff, cutoff + 8), ROSTER, cutoff, () => (cutoff + 45) * 1000);
    expect(result).toMatchObject({ resolved: 29, admissible: false, late: true });
    const kinds = (await getCutoff(cutoff)).incidents.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(["venue_unavailable", "asset_unresolved", "archive_late", "snapshot_inadmissible"]));
    expect((await getCutoff(cutoff)).snapshot).toMatchObject({ admissible: false });
  });

  it("feeds archived cutoffs in order and reports the feed check", async () => {
    let cursor = null;
    const seen: number[] = [];
    for (;;) {
      const page = await readSnapshotChanges(cursor, 10);
      if (page.snapshots.length === 0) break;
      seen.push(...page.snapshots.map((s) => s.cutoff));
      cursor = page.cursor;
    }
    expect(seen).toEqual([BASE, BASE + 60, BASE + 120]);
    const check = await feedCheck(BASE, BASE + 180);
    expect(check).toMatchObject({ snapshots: 2, lateSnapshots: 1, admissibleSnapshots: 2 });
    const btc = check.assets.find((a) => a.assetId === "BTC")!;
    expect(btc).toMatchObject({ cutoffs: 2, inadmissible: 0, passes: true });
    const trx = check.assets.find((a) => a.assetId === "TRX")!;
    expect(trx.byStep["bybit:3"]).toBeCloseTo(1 / 2);
    expect(renderFeedCheck(check)).toContain("excluded below: 1");

    const onTime = BASE + 180;
    const failing: Script = (url, c) => (url.includes("XXBTZUSD") || url.includes("BTC") ? { status: 503, body: "down" } : everyoneTrades(url, c));
    await archiveCutoff(deps(failing, onTime, onTime + 8), ROSTER, onTime, () => (onTime + 20) * 1000);
    const after = await feedCheck(BASE, BASE + 240);
    expect(after.assets.find((a) => a.assetId === "BTC")).toMatchObject({ cutoffs: 3, inadmissible: 1, passes: false });
    expect(after.assets.find((a) => a.assetId === "ETH")).toMatchObject({ cutoffs: 3, inadmissible: 0, passes: true });
  });
});
