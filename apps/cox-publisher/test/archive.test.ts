import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bybitUsd, PILOT_ASSETS, sha256, snapshotBytes, type AssetId, type Price } from "@cox/methodology";
import { HttpArchive } from "../src/archive.ts";
import type { MethodologyPolicy } from "../src/types.ts";

const cutoff = 1791600000n;
const artifact = Buffer.from('{"archived":"venue-response"}');
const artifactDigest = sha256(artifact);
const conversion = Buffer.from('{"archived":"USDT/USD-response"}');
const conversionDigest = sha256(conversion);
const policy: MethodologyPolicy = { assets: ["BTC", "ETH"], origin: cutoff, bybit: false, digest: "1".repeat(64) };
function fixture(roster: readonly AssetId[] = policy.assets) {
  const prices: Price[] = roster.map((assetId, index) => ({ assetId, venue: 0, step: index === 1 ? 4 : 1, candleStart: cutoff - 60n - (index === 1 ? 60n : 0n), tradeAgeMinutes: index === 1 ? 1 : 0, priceE8: BigInt(index + 1) * 10000000000n }));
  return {
    schema: "cox.evidence/v1", rule: "COX/PRICE-FALLBACK/V1", cutoff: Number(cutoff), priceScale: "100000000",
    snapshot: { digest: sha256(snapshotBytes(cutoff, prices, roster)), digestEncoding: "COX/WIRE/V1", admissible: true, recordedAtMs: Number(cutoff * 1000n + 29999n) },
    assets: prices.map((price, index) => ({
      assetId: price.assetId, position: PILOT_ASSETS.findIndex(asset => asset.id === price.assetId),
      attempts: Array.from({ length: price.step }, (_, step) => ({ step: step + 1, venue: ["kraken", "coinbase", "bybit", "kraken"][step], outcome: step === price.step - 1 ? "trades" : "empty", artifactDigest: step === price.step - 1 ? artifactDigest : null })),
      price: { venue: "kraken", step: price.step, candleStart: Number(price.candleStart), close: String((index + 1) * 100), usdtUsd: null as string | null, usdtArtifactDigest: null as string | null, priceE8: String(price.priceE8), tradeEvidence: "2", tradeAgeMinutes: price.tradeAgeMinutes, artifactDigest, admissible: true, rejection: null },
    })),
    usdtUsd: { attempts: [] as { step: number; venue: string; outcome: string; artifactDigest: string | null }[] }, incidents: [],
  };
}
type View = ReturnType<typeof fixture>;
function archive(view: View, options: { tamper?: boolean; missing?: boolean; maxBytes?: number } = {}) {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/prices/cutoffs/")) return options.missing ? new Response("missing", { status: 404 }) : Response.json(view);
    if (url.endsWith(conversionDigest)) return new Response(conversion);
    if (url.endsWith(artifactDigest)) return new Response(options.tamper ? "changed bytes" : artifact);
    throw new Error("Unexpected fetch");
  };
  return { reader: new HttpArchive("http://archive.test", { fetch: fetcher, maxBytes: options.maxBytes }), urls };
}
function rehash(view: View, roster: readonly AssetId[] = policy.assets) {
  const prices: Price[] = view.assets.map(entry => ({ assetId: entry.assetId, venue: ["kraken", "coinbase", "bybit"].indexOf(entry.price.venue) as 0 | 1 | 2, step: entry.price.step as 1 | 2 | 3 | 4, candleStart: BigInt(entry.price.candleStart), priceE8: BigInt(entry.price.priceE8), tradeAgeMinutes: entry.price.tradeAgeMinutes }));
  view.snapshot.digest = sha256(snapshotBytes(cutoff, prices, roster));
}
test("admits the API shape with the authoritative P1 snapshot fingerprint", async () => {
  const vectors = JSON.parse(readFileSync(new URL("../../../packages/cox/fixtures/vectors.json", import.meta.url), "utf8"));
  const view = fixture();
  assert.equal(view.snapshot.digest, vectors.wire.snapshot.digest);
  const { reader, urls } = archive(view);
  const result = await reader.snapshot(cutoff, policy);
  assert.equal(result?.digest, vectors.wire.snapshot.digest);
  assert.equal(result?.archiveTime, cutoff + 29n);
  assert.equal(result?.prices[1]?.tradeAgeMinutes, 1);
  assert.equal(urls.filter(url => url.includes("/artifacts/")).length, 1);
  assert.ok(urls.every(url => url.startsWith("http://archive.test/v1/")));
});
test("admits all 30 canonical assets without changing the archived hash", async () => {
  const assets = PILOT_ASSETS.map(asset => asset.id as AssetId);
  const view = fixture(assets);
  const result = await archive(view).reader.snapshot(cutoff, { ...policy, assets });
  assert.equal(result?.prices.length, 30);
  assert.equal(result?.digest, view.snapshot.digest);
});
test("404 and explicitly inadmissible snapshots are not publishable", async () => {
  assert.equal(await archive(fixture(), { missing: true }).reader.snapshot(cutoff, policy), null);
  const view = fixture(); view.snapshot.admissible = false;
  Object.assign(view.snapshot, { digest: null, digestEncoding: null });
  assert.equal(await archive(view).reader.snapshot(cutoff, policy), null);
});
const mutations: [string, (view: View) => void][] = [
  ["legacy digest encoding", view => { view.snapshot.digestEncoding = "provisional"; }],
  ["wrong fingerprint", view => { view.snapshot.digest = "0".repeat(64); }],
  ["wrong roster order", view => { view.assets.reverse(); }],
  ["wrong asset position", view => { view.assets[0]!.position = 1; }],
  ["wrong exact USD conversion", view => { view.assets[0]!.price.priceE8 = "1"; }],
  ["excess USD precision", view => { view.assets[0]!.price.close = "100.000000001"; }],
  ["unsupported venue", view => { view.assets[0]!.price.venue = "other"; }],
  ["incorrect trade age", view => { view.assets[1]!.price.tradeAgeMinutes = 2; }],
  ["zero trade evidence", view => { view.assets[0]!.price.tradeEvidence = "0.000"; }],
  ["selected artifact mismatch", view => { view.assets[0]!.price.artifactDigest = "0".repeat(64); }],
  ["fallback after trades", view => { view.assets[1]!.attempts[0]!.outcome = "trades"; }],
  ["late by one millisecond", view => { view.snapshot.recordedAtMs = Number((cutoff + 30n) * 1000n + 1n); }],
  ["before cutoff", view => { view.snapshot.recordedAtMs = Number(cutoff * 1000n - 1n); }],
  ["wrong cutoff", view => { view.cutoff += 60; }],
  ["wrong scale", view => { view.priceScale = "1000000"; }],
  ["inadmissible asset", view => { view.assets[0]!.price.admissible = false; }],
];
for (const [name, mutate] of mutations) test(`rejects ${name}`, async () => {
  const view = fixture(); mutate(view);
  await assert.rejects(archive(view).reader.snapshot(cutoff, policy));
});
test("accepts the exact archive deadline but never silently hashes a subset", async () => {
  const view = fixture(); view.snapshot.recordedAtMs = Number((cutoff + 30n) * 1000n);
  assert.ok(await archive(view).reader.snapshot(cutoff, policy));
  const assets = PILOT_ASSETS.map(asset => asset.id as AssetId);
  await assert.rejects(archive(fixture(assets)).reader.snapshot(cutoff, policy), /roster/);
});
function bybitFixture() {
  const view = fixture();
  const entry = view.assets[0]!;
  entry.price.venue = "bybit"; entry.price.step = 3; entry.price.close = "0.331";
  entry.price.usdtUsd = "0.99985"; entry.price.usdtArtifactDigest = conversionDigest;
  entry.price.priceE8 = String(bybitUsd("0.331", "0.99985"));
  entry.attempts = [
    { step: 1, venue: "kraken", outcome: "empty", artifactDigest: null },
    { step: 2, venue: "coinbase", outcome: "unavailable", artifactDigest: null },
    { step: 3, venue: "bybit", outcome: "trades", artifactDigest },
  ];
  view.usdtUsd.attempts = [{ step: 1, venue: "kraken", outcome: "trades", artifactDigest: conversionDigest }];
  rehash(view);
  return view;
}
test("Bybit requires enabled policy, exact conversion, and archived conversion evidence", async () => {
  const view = bybitFixture();
  const enabled = { ...policy, bybit: true };
  assert.equal((await archive(view).reader.snapshot(cutoff, enabled))?.prices[0]?.priceE8, 33095035n);
  await assert.rejects(archive(view).reader.snapshot(cutoff, policy), /Bybit/);
  view.usdtUsd.attempts = [];
  await assert.rejects(archive(view).reader.snapshot(cutoff, enabled), /conversion evidence/);
  const bad = bybitFixture(); bad.assets[0]!.price.priceE8 = "33095036";
  await assert.rejects(archive(bad).reader.snapshot(cutoff, enabled), /conversion/);
});
test("tampered artifacts, malformed JSON and oversized responses fail closed", async () => {
  await assert.rejects(archive(fixture(), { tamper: true }).reader.snapshot(cutoff, policy), /artifact fingerprint/);
  await assert.rejects(archive(fixture(), { maxBytes: 10 }).reader.snapshot(cutoff, policy), /too large/);
  const reader = new HttpArchive("http://archive.test", { fetch: async () => new Response("{broken") });
  await assert.rejects(reader.snapshot(cutoff, policy), SyntaxError);
});
test("HTTP failures and request timeouts are surfaced without fetching exchanges", async () => {
  const error = new HttpArchive("http://archive.test", { fetch: async () => new Response("bad", { status: 503 }) });
  await assert.rejects(error.snapshot(cutoff, policy), /503/);
  const timeout = new HttpArchive("http://archive.test", { timeoutMs: 5, fetch: async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); }) });
  await assert.rejects(timeout.snapshot(cutoff, policy), /aborted/);
});
test("artifact verification runs concurrently with at most four archive reads", async () => {
  const assets = PILOT_ASSETS.slice(0, 10).map(asset => asset.id as AssetId);
  const view = fixture(assets);
  const payloads = new Map<string, Buffer>();
  for (const entry of view.assets) {
    const payload = Buffer.from(`archived-${entry.assetId}`);
    const digest = sha256(payload);
    payloads.set(digest, payload);
    entry.price.artifactDigest = digest;
    entry.attempts[entry.price.step - 1]!.artifactDigest = digest;
  }
  let active = 0;
  let maximum = 0;
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.includes("/prices/")) return Response.json(view);
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    const bytes = payloads.get(url.split("/").at(-1)!);
    assert.ok(bytes);
    return new Response(Uint8Array.from(bytes));
  };
  assert.equal((await new HttpArchive("http://archive.test", { fetch: fetcher }).snapshot(cutoff, { ...policy, assets }))?.prices.length, 10);
  assert.equal(maximum, 4);
});
