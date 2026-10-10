import { writeFileSync } from "node:fs";
import { compileManifest, DEV_RUNTIME, PILOT_ASSETS, SCALE, priceBytes, sha256, snapshotBytes, type AssetId } from "./index.ts";
import { batch, reference, revalue, type Request } from "./vectors.ts";
const serialize = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
const manifest = compileManifest({ version: "pilot-draft-1", status: "draft", assets: PILOT_ASSETS.map(asset => asset.id as AssetId), originUnixSeconds: null, runtimeAuthority: DEV_RUNTIME, bybitEnabled: false, feedCheckDigest: null });
writeFileSync(new URL("../manifest.draft.json", import.meta.url), serialize(manifest));
const base = [{ backing: 100n, units: 100n * SCALE }, { backing: 50n, units: 50n * SCALE }];
const worked = [{ backing: 90n, units: 100n * SCALE }, { backing: 60n, units: 50n * SCALE }];
const requests: Request[] = [
  { id: "entry", kind: "deposit", to: 0, amount: 30n, minimum: 0n, expiry: 3 },
  { id: "exit", kind: "redeem", from: 1, units: 10n * SCALE, minimum: 12n, expiry: 3 },
];
const prices = [100n, 100n];
const priceWire = [
  { assetId: "BTC" as const, venue: 0 as const, step: 1 as const, candleStart: 1791599940n, priceE8: 10000000000n, tradeAgeMinutes: 0 },
  { assetId: "ETH" as const, venue: 0 as const, step: 4 as const, candleStart: 1791599880n, priceE8: 20000000000n, tradeAgeMinutes: 1 },
];
const cases = [
  { name: "equal-returns", kind: "reference", input: { previous: prices, current: [110n, 110n], origin: prices, previousBenchmark: 100n * SCALE }, output: reference(prices, [110n, 110n], prices, 100n * SCALE) },
  { name: "missed-minute-rebalance-freeze", kind: "reference", input: { previousBatch: 1, missedBatches: [2], publicationBatch: 3, previous: prices, current: [120n, 80n], origin: prices, previousBenchmark: 100n * SCALE }, output: reference(prices, [120n, 80n], prices, 100n * SCALE) },
  { name: "mvp0-redistribution", kind: "revalue", input: { classes: [...base, { backing: 0n, units: 0n }], h: [1200000000000n, 800000000000n, SCALE] }, output: revalue([...base, { backing: 0n, units: 0n }], [1200000000000n, 800000000000n, SCALE]) },
  { name: "paper3-section12", kind: "batch", input: { classes: worked, requests, publicationBatch: 1, pending: 30n, vault: 180n }, output: batch(worked, requests, 1) },
  { name: "empty-class", kind: "batch", input: { classes: [{ backing: 0n, units: 0n }], requests: [{ id: "bootstrap", kind: "deposit", to: 0, amount: 7n, minimum: 0n, expiry: 1 }], publicationBatch: 1 }, output: batch([{ backing: 0n, units: 0n }], [{ id: "bootstrap", kind: "deposit", to: 0, amount: 7n, minimum: 0n, expiry: 1 }], 1) },
  { name: "condition-failure", kind: "batch", input: { classes: worked, requests: [{ ...requests[0]!, minimum: 34n * SCALE }], publicationBatch: 1 }, output: batch(worked, [{ ...requests[0]!, minimum: 34n * SCALE }], 1) },
  { name: "expiry-after-miss", kind: "batch", input: { classes: worked, requests: [{ ...requests[0]!, expiry: 2 }], publicationBatch: 3 }, output: batch(worked, [{ ...requests[0]!, expiry: 2 }], 3) },
  { name: "switch", kind: "batch", input: { classes: worked, requests: [{ id: "rotate", kind: "switch", from: 1, to: 0, units: 10n * SCALE, minimum: 0n, expiry: 1 }], publicationBatch: 1 }, output: batch(worked, [{ id: "rotate", kind: "switch", from: 1, to: 0, units: 10n * SCALE, minimum: 0n, expiry: 1 }], 1) },
  { name: "full-drain", kind: "batch", input: { classes: base, requests: [{ id: "a", kind: "redeem", from: 0, units: 100n * SCALE, minimum: 0n, expiry: 1 }, { id: "b", kind: "redeem", from: 1, units: 50n * SCALE, minimum: 0n, expiry: 1 }], publicationBatch: 1 }, output: batch(base, [{ id: "a", kind: "redeem", from: 0, units: 100n * SCALE, minimum: 0n, expiry: 1 }, { id: "b", kind: "redeem", from: 1, units: 50n * SCALE, minimum: 0n, expiry: 1 }], 1) },
];
writeFileSync(new URL("../../cox/fixtures/vectors.json", import.meta.url), serialize({ schema: "COX/VECTORS/V1", status: "P1 specification oracle; P2 Rust parity pending", integerEncoding: "decimal strings; collateral amounts are base units", manifest, wire: { prices: priceWire.map(price => ({ input: price, bytes: priceBytes(price).toString("hex"), digest: sha256(priceBytes(price)) })), snapshot: { cutoff: 1791600000n, roster: ["BTC", "ETH"], bytes: snapshotBytes(1791600000n, priceWire, ["BTC", "ETH"]).toString("hex"), digest: sha256(snapshotBytes(1791600000n, priceWire, ["BTC", "ETH"])) } }, cases }));
