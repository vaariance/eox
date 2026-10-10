import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bybitUsd, compileManifest, DEV_RUNTIME, exactUsd, PILOT_ASSETS, priceBytes, round, SCALE, sha256, snapshotBytes, type AssetId, type ManifestConfig } from "../src/index.ts";
import { batch, checked, reference, revalue, type Request } from "../src/vectors.ts";
const config: ManifestConfig = { version: "pilot-draft-1", status: "draft", assets: PILOT_ASSETS.map(asset => asset.id as AssetId), originUnixSeconds: null, runtimeAuthority: DEV_RUNTIME, bybitEnabled: false, feedCheckDigest: null };
const json = (value: unknown) => JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item));
const fixtures = JSON.parse(readFileSync(new URL("../../cox/fixtures/vectors.json", import.meta.url), "utf8"));

test("canonical manifest includes 30 ordered assets and is independent of object property order", () => {
  assert.equal(compileManifest(config).assetCount, 30);
  assert.deepEqual(compileManifest(config), compileManifest({ ...config }));
  assert.deepEqual(compileManifest(config), fixtures.manifest);
  const canonical = JSON.parse(compileManifest(config).canonical);
  assert.deepEqual(canonical[4].map((asset: string[]) => asset[0]), config.assets);
  assert.equal(canonical[4][5][3], null);
  assert.equal(canonical[4][16][4], null);
  assert.notEqual(compileManifest({ ...config, bybitEnabled: true }).digest, compileManifest(config).digest);
});
test("roster reductions preserve order and change exact weight denominator", () => {
  const reduced = compileManifest({ ...config, assets: ["BTC", "ETH"] });
  assert.equal(JSON.parse(reduced.canonical)[4][0][6], "2");
  assert.equal(reduced.label, "CRYPTO (pilot, 2 assets)");
  assert.throws(() => compileManifest({ ...config, assets: ["ETH", "BTC"] }), /NonCanonicalRoster/);
  assert.throws(() => compileManifest({ ...config, assets: ["BTC", "BTC"] }), /InvalidRoster/);
});
test("seal requires feed evidence and aligned actual origin", () => {
  assert.throws(() => compileManifest({ ...config, status: "sealed" }), /UnsealableManifest/);
  assert.throws(() => compileManifest({ ...config, originUnixSeconds: 61 }), /InvalidOrigin/);
  assert.throws(() => compileManifest({ ...config, feedCheckDigest: "bad" }), /InvalidFeed/);
  assert.doesNotThrow(() => compileManifest({ ...config, status: "sealed", originUnixSeconds: 1791600000, feedCheckDigest: "a".repeat(64) }));
});
test("USD conversion is exact and rejects excess lexical precision including trailing zeros", () => {
  assert.equal(exactUsd("12.00000001"), 1200000001n);
  for (const value of ["0", "-1", "1.000000000", "1e2", "NaN", "01", "1."]) assert.throws(() => exactUsd(value));
  assert.equal(round(5n, 2n), 3n);
  assert.equal(round(-5n, 2n), -3n);
});
test("price and snapshot bytes match frozen vectors and reject inconsistent venue/time/order", () => {
  const prices = fixtures.wire.prices.map((entry: any) => ({ ...entry.input, priceE8: BigInt(entry.input.priceE8), candleStart: BigInt(entry.input.candleStart) }));
  prices.forEach((price: any, i: number) => {
    assert.equal(priceBytes(price).toString("hex"), fixtures.wire.prices[i].bytes);
    assert.equal(sha256(priceBytes(price)), fixtures.wire.prices[i].digest);
  });
  assert.equal(sha256(snapshotBytes(1791600000n, prices, ["BTC", "ETH"])), fixtures.wire.snapshot.digest);
  assert.throws(() => snapshotBytes(1791600000n, [...prices].reverse(), ["BTC", "ETH"]));
  assert.throws(() => priceBytes({ ...prices[0], step: 2 }));
  assert.throws(() => snapshotBytes(1791600000n, [{ ...prices[0], tradeAgeMinutes: 1 }, prices[1]], ["BTC", "ETH"]));
  assert.throws(() => priceBytes({ ...prices[1], tradeAgeMinutes: 31 }));
});
test("all checked-in arithmetic fixtures replay exactly", () => {
  for (const fixture of fixtures.cases) {
    const input = fixture.input;
    let actual;
    if (fixture.kind === "reference") actual = reference(input.previous.map(BigInt), input.current.map(BigInt), input.origin.map(BigInt), BigInt(input.previousBenchmark));
    else {
      const classes = input.classes.map((value: any) => ({ backing: BigInt(value.backing), units: BigInt(value.units) }));
      if (fixture.kind === "revalue") actual = revalue(classes, input.h.map(BigInt));
      else actual = batch(classes, input.requests.map((request: any) => ({ ...request, minimum: BigInt(request.minimum), ...(request.amount !== undefined ? { amount: BigInt(request.amount) } : {}), ...(request.units !== undefined ? { units: BigInt(request.units) } : {}) })), input.publicationBatch);
    }
    assert.deepEqual(json(actual), fixture.output, fixture.name);
  }
});
test("Paper 3 integer worked example independently reconciles vault before and after withdrawal", () => {
  const result = fixtures.cases.find((item: any) => item.name === "paper3-section12").output;
  assert.equal(result.receipts[0].minted, (30n * 100n * SCALE / 90n).toString());
  assert.equal(result.classes[0].backing, "119");
  assert.equal(result.classes[1].backing, "48");
  assert.equal(result.payable, "12");
  assert.equal(result.residual, "1");
  assert.equal(119 + 48 + 12 + 1, 180);
  assert.equal(119 + 48 + 1, 180 - 12);
});
test("batch permutations preserve outcomes and backing", () => {
  const classes = [{ backing: 90n, units: 100n * SCALE }, { backing: 60n, units: 50n * SCALE }];
  const requests: Request[] = [{ id: "d", kind: "deposit", to: 0, amount: 30n, minimum: 0n, expiry: 1 }, { id: "r", kind: "redeem", from: 1, units: 10n * SCALE, minimum: 0n, expiry: 1 }, { id: "s", kind: "switch", from: 0, to: 1, units: 2n * SCALE, minimum: 0n, expiry: 1 }];
  const first = batch(classes, requests, 1);
  const second = batch(classes, [...requests].reverse(), 1);
  assert.deepEqual(first.classes, second.classes);
  assert.equal(first.residual, second.residual);
  assert.deepEqual([...first.receipts].sort((a,b) => a.id.localeCompare(b.id)), [...second.receipts].sort((a,b) => a.id.localeCompare(b.id)));
});
test("split floors cannot manufacture user output; zero value burns and reservation bounds are enforced", () => {
  for (let n = 1n; n < 30n; n++) for (let d = 1n; d < 30n; d++) for (let x = 1n; x < 10n; x++) assert.ok(x*n/d + x*n/d <= 2n*x*n/d);
  const classes = [{ backing: 0n, units: SCALE }];
  const result = batch(classes, [{ id: "close", kind: "redeem", from: 0, units: SCALE, minimum: 0n, expiry: 1 }], 1);
  assert.equal(result.classes[0]!.units, 0n);
  assert.equal(result.receipts[0]!.outcome, "Filled");
  assert.throws(() => batch(classes, [{ id: "too-many", kind: "redeem", from: 0, units: SCALE + 1n, minimum: 0n, expiry: 1 }], 1), /OverReserved/);
  assert.equal(batch(classes, [{ id: "entry", kind: "deposit", to: 0, amount: 1n, minimum: 0n, expiry: 1 }], 1).receipts[0]!.outcome, "ZeroValueClass");
});
test("one-sided backing stays backed, transfer dust is explicit, overflow is rejected", () => {
  assert.deepEqual(revalue([{ backing: 100n, units: SCALE }, { backing: 0n, units: 0n }], [2n*SCALE, SCALE]).classes.map(value => value.backing), [100n, 0n]);
  const result = revalue([{ backing: 1n, units: SCALE }, { backing: 1n, units: SCALE }], [SCALE, 2n*SCALE]);
  assert.equal(result.classes.reduce((sum,value) => sum+value.backing, 0n) + result.residual, 2n);
  assert.throws(() => checked(1n << 127n), /ArithmeticOverflow/);
  assert.throws(() => revalue([{ backing: 1n, units: SCALE }], [0n]), /ZeroTransferDenominator/);
});

test("Bybit conversion rounds once with exact inputs and a half-away tie", () => {
  assert.equal(bybitUsd("1.000000005", "1"), 100000001n);
  assert.equal(bybitUsd("2.5", "0.9999"), 249975000n);
  assert.throws(() => bybitUsd("0", "1"), /InvalidPrice/);
});
test("unequal growth produces independently calculated reference levels", () => {
  const result = reference([100n,100n], [120n,80n], [100n,100n], 100n*SCALE);
  assert.equal(result.benchmark, 100n*SCALE);
  assert.deepEqual(result.relative, [120n*SCALE,80n*SCALE]);
  const rising = reference([100n,100n], [120n,100n], [100n,100n], 100n*SCALE);
  assert.equal(rising.benchmark, 110n*SCALE);
  assert.deepEqual(rising.relative, [109090909090909n,90909090909091n]);
});

test("fill timing is separate from snapshot acceptance and expiry uses the bound batch", () => {
  const clocks = JSON.parse(compileManifest(config).canonical)[8];
  assert.deepEqual(clocks.slice(0,7), [60,30,55,"SNAPSHOT_ACCEPTANCE_ONLY","NO_FILL_DEADLINE",60,"EXECUTION_CAPACITY_TARGET_SECONDS"]);
  const request: Request = { id: "bound", kind: "deposit", to: 0, amount: 7n, minimum: 0n, expiry: 1 };
  assert.equal(batch([{ backing: 0n, units: 0n }], [request], 1).receipts[0]!.outcome, "Filled");
  assert.equal(batch([{ backing: 0n, units: 0n }], [request], 2).receipts[0]!.outcome, "Expired");
});
