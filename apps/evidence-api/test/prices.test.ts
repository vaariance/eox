import type { AddressInfo } from "node:net";
import {
  pool,
  recordAssetResolution,
  recordIncident,
  recordSnapshot,
  recordSourcePayload,
  recordVenueResponse,
  registerAsset,
} from "@eox/evidence-store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEvidenceServer } from "../src/server.js";

const server = createEvidenceServer((error) => {
  throw error;
});
let baseUrl = "";
const CUTOFF = 1_950_000_000 - (1_950_000_000 % 60);
const get = (path: string) => fetch(`${baseUrl}${path}`);

async function payload(sourceId: "kraken" | "coinbase" | "bybit", body: string): Promise<string> {
  return (await recordSourcePayload({ sourceId, requestUrl: `https://${sourceId}.test`, httpStatus: 200, contentType: "application/json", body: new TextEncoder().encode(body) })).sha256;
}

async function archive(cutoff: number, withSnapshot: boolean): Promise<{ kraken: string; bybit: string; usdt: string }> {
  const kraken = await payload("kraken", `{"btc":${cutoff}}`);
  const bybit = await payload("bybit", `{"trx":${cutoff}}`);
  const usdt = await payload("kraken", `{"usdt":${cutoff}}`);
  for (const [assetId, raw] of [["BTC", kraken], ["TRX", bybit], ["USDT", usdt]] as const) {
    await recordVenueResponse({ venue: assetId === "TRX" ? "bybit" : "kraken", assetId, cutoff, request: `GET ${assetId}`, rawSha256: raw });
  }
  const btc = await recordAssetResolution({
    assetId: "BTC",
    cutoff,
    attempts: [{ venue: "kraken", step: 1, outcome: "trades", rawSha256: kraken }],
    observation: { venue: "kraken", step: 1, candleStart: cutoff - 60, close: "82758.6", usdtUsd: null, usdtRawSha256: null, priceE8: "8275860000000", tradeEvidence: "80", tradeAgeMinutes: 0, rawSha256: kraken, rejection: null },
  });
  const trx = await recordAssetResolution({
    assetId: "TRX",
    cutoff,
    attempts: [
      { venue: "kraken", step: 1, outcome: "empty", rawSha256: null },
      { venue: "coinbase", step: 2, outcome: "not-listed", rawSha256: null },
      { venue: "bybit", step: 3, outcome: "trades", rawSha256: bybit },
    ],
    observation: { venue: "bybit", step: 3, candleStart: cutoff - 60, close: "0.331", usdtUsd: "0.99985", usdtRawSha256: usdt, priceE8: "33095035", tradeEvidence: "2381.2", tradeAgeMinutes: 0, rawSha256: bybit, rejection: null },
  });
  await recordAssetResolution({ assetId: "USDT", cutoff, attempts: [{ venue: "kraken", step: 1, outcome: "trades", rawSha256: usdt }], observation: null });
  await recordIncident({ cutoff, kind: "venue_rate_limited", assetId: "TRX", venue: "coinbase", detail: "HTTP 429", rawSha256: null });
  if (withSnapshot) {
    await recordSnapshot({ cutoff, observationIds: [btc.observation!.id, trx.observation!.id], snapshotDigest: "e".repeat(64), admissible: true });
  }
  return { kraken, bybit, usdt };
}

beforeAll(async () => {
  await registerAsset({ assetId: "BTC", position: 0, krakenWsSymbol: "BTC/USD", krakenRestPair: "XXBTZUSD", coinbaseProduct: "BTC-USD", bybitSymbol: "BTCUSDT" });
  await registerAsset({ assetId: "TRX", position: 5, krakenWsSymbol: "TRX/USD", krakenRestPair: "TRXUSD", coinbaseProduct: null, bybitSymbol: "TRXUSDT" });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await pool.end();
});

describe("price cutoffs", () => {
  it("serves an archived cutoff with every attempt, the chosen price and its evidence in canonical order", async () => {
    const digests = await archive(CUTOFF, true);
    const res = await get(`/v1/prices/cutoffs/${CUTOFF}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body).toMatchObject({ schema: "cox.evidence/v1", rule: "COX/PRICE-FALLBACK/V1", cutoff: CUTOFF, priceScale: "100000000", snapshot: { digest: "e".repeat(64), admissible: true } });
    expect(body.assets.map((a: { assetId: string }) => a.assetId)).toEqual(["BTC", "TRX"]);
    expect(body.assets[0].price).toMatchObject({ venue: "kraken", step: 1, close: "82758.6", priceE8: "8275860000000", artifactDigest: digests.kraken, admissible: true });
    expect(body.assets[1].attempts).toEqual([
      { step: 1, venue: "kraken", outcome: "empty", artifactDigest: null },
      { step: 2, venue: "coinbase", outcome: "not-listed", artifactDigest: null },
      { step: 3, venue: "bybit", outcome: "trades", artifactDigest: digests.bybit },
    ]);
    expect(body.assets[1].price).toMatchObject({ venue: "bybit", close: "0.331", usdtUsd: "0.99985", usdtArtifactDigest: digests.usdt, priceE8: "33095035" });
    expect(body.usdtUsd.attempts).toEqual([{ step: 1, venue: "kraken", outcome: "trades", artifactDigest: digests.usdt }]);
    expect(body.incidents).toEqual([expect.objectContaining({ kind: "venue_rate_limited", assetId: "TRX", venue: "coinbase", detail: "HTTP 429" })]);
    const artifact = await get(`/v1/artifacts/${digests.bybit}`);
    expect(artifact.status).toBe(200);
    expect(artifact.headers.get("x-content-sha256")).toBe(digests.bybit);
  });

  it("does not serve a cutoff whose snapshot is not written yet, and validates the cutoff", async () => {
    await archive(CUTOFF + 60, false);
    expect((await get(`/v1/prices/cutoffs/${CUTOFF + 60}`)).status).toBe(404);
    for (const bad of [`${CUTOFF + 1}`, "abc", "0", "-60", "1e9"]) {
      expect((await get(`/v1/prices/cutoffs/${bad}`)).status, bad).toBe(400);
    }
  });
});

describe("price changes", () => {
  it("lists archived cutoffs once, in commit order, and resumes from the returned cursor", async () => {
    const first = await (await get("/v1/prices/changes?limit=1")).json() as { after: string; cutoffs: { cutoff: number }[] };
    expect(first.cutoffs.map((c) => c.cutoff)).toEqual([CUTOFF]);
    const ids = await recordSnapshot({ cutoff: CUTOFF + 120, observationIds: [], snapshotDigest: "f".repeat(64), admissible: false });
    expect(ids.admissible).toBe(false);
    const next = await (await get(`/v1/prices/changes?after=${first.after}`)).json() as { after: string; cutoffs: { cutoff: number; admissible: boolean }[] };
    expect(next.cutoffs).toEqual([{ cutoff: CUTOFF + 120, admissible: false, snapshotDigest: "f".repeat(64) }]);
    const empty = await (await get(`/v1/prices/changes?after=${next.after}`)).json() as { after: string; cutoffs: unknown[] };
    expect(empty).toMatchObject({ after: next.after, cutoffs: [] });
    expect((await get("/v1/prices/changes?after=nope")).status).toBe(400);
  });
});
