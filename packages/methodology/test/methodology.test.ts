import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createHash } from "node:crypto";
import { CATALOGUE, COUNTRIES, INDICATORS, compileMethodology, exactFixed, gdpMillions, periodOrdinal, seriesDescriptor, seriesIdentity, type MethodologyPolicy } from "../src/index.js";

const fixture = (): MethodologyPolicy => JSON.parse(readFileSync(new URL("../fixtures/synthetic-policy.json", import.meta.url), "utf8")) as MethodologyPolicy;

test("all 180 catalogue entries preserve source, country and native frequency", () => {
  assert.equal(COUNTRIES.length, 30);
  assert.equal(CATALOGUE.length, 180);
  assert.equal(new Set(CATALOGUE.map(row => `${row.country}/${row.indicator}`)).size, 180);
  assert.equal(seriesDescriptor("NZL", "cpi_core_yoy").frequency, "quarterly");
  assert.equal(seriesDescriptor("NZL", "unemployment_rate").frequency, "quarterly");
  assert.equal(seriesDescriptor("USA", "cpi_core_yoy").frequency, "monthly");
  assert.equal(seriesDescriptor("JPN", "policy_rate").frequency, "monthly");
  assert.equal(seriesDescriptor("USA", "gdp_real_volume").unit, "national_currency_millions");
});

test("compiler emits ISO2 country identifiers and exact Oracle rule fields", () => {
  const output = compileMethodology(fixture());
  assert.deepEqual(output.configuration.countries.map(country => country.id), ["JP", "NZ", "US"]);
  const country = output.configuration.countries[0]!;
  assert.deepEqual(country.indicators.map(indicator => indicator.id), [...INDICATORS]);
  const rule = country.indicators[0]!.rule;
  assert.deepEqual(rule.normalization, { Directional: { lower: "-100000", upper: "100000", direction: 1 } });
  assert.equal(rule.comparison_period_delta, "1");
  assert.equal(rule.grace_seconds, "2592000");
  assert.deepEqual(rule.source, [...createHash("sha256").update("imf-portwatch").digest()]);
  assert.deepEqual(rule.series_id, [...createHash("sha256").update(seriesIdentity("JPN", "container_throughput")).digest()]);
});

test("canonical manifest ignores input ordering and equivalent decimal spelling", () => {
  const policy = fixture();
  const first = compileMethodology(policy);
  policy.countries.reverse();
  for (const country of policy.countries) country.indicators.reverse();
  const second = compileMethodology(policy);
  assert.deepEqual(second, first);
  const bound = policy.countries[0]!.indicators.find(row => row.indicator === "container_throughput")!.normalization;
  if (bound.kind === "directional") bound.lower = "-00.10000000";
  assert.deepEqual(compileMethodology(policy), first);
  assert.equal(first.manifestDigest, createHash("sha256").update(first.canonicalManifest).digest("hex"));
});

test("policy mutations change commitment without resetting series identity", () => {
  const baseline = compileMethodology(fixture());
  for (const mutate of [
    (p: MethodologyPolicy) => { p.version = "changed"; },
    (p: MethodologyPolicy) => { p.epochId = "changed"; },
    (p: MethodologyPolicy) => { p.multiplier = 21; },
    (p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.weight = 2; },
    (p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.sourceAuthority = 9000; },
    (p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.freshness.graceSeconds = 1; },
    (p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.rationale = "Changed policy rationale"; },
  ]) {
    const input = fixture();
    mutate(input);
    const result = compileMethodology(input);
    assert.notEqual(result.manifestDigest, baseline.manifestDigest);
    assert.deepEqual(result.configuration.countries.map(c => c.indicators.map(i => i.rule.series_id)), baseline.configuration.countries.map(c => c.indicators.map(i => i.rule.series_id)));
  }
});

test("decimal precision is exact, bounded, and rejects non-decimal notation", () => {
  assert.equal(exactFixed("-1.000001"), "-1000001");
  assert.equal(exactFixed("1000000000000.00000000"), "1000000000000000000");
  assert.equal(exactFixed("-0.0000000"), "0");
  for (const value of ["1e6", "NaN", "+1", " 1", "1.", ".1"]) assert.throws(() => exactFixed(value), /InvalidDecimal/);
  assert.throws(() => exactFixed("0.0000001"), /ExcessPrecision/);
  assert.throws(() => exactFixed("1000000000000.000001"), /MagnitudeExceeded/);
});

test("GDP unit scaling preserves declared multipliers without rounding", () => {
  assert.equal(gdpMillions("123456789", 0), "123.456789");
  assert.equal(gdpMillions("123.456789", 6), "123.456789");
  assert.equal(gdpMillions("-123.4500", 3), "-0.123450");
  assert.throws(() => gdpMillions("123.4567", 3), /ExcessPrecision/);
  assert.throws(() => gdpMillions("123", 7), /InvalidUnitMultiplier/);
});

test("period ordinals respect valid calendar boundaries and leap years", () => {
  assert.equal(BigInt(periodOrdinal("monthly", "2026-01")) - BigInt(periodOrdinal("monthly", "2025-12")), 1n);
  assert.equal(BigInt(periodOrdinal("quarterly", "2026-Q1")) - BigInt(periodOrdinal("quarterly", "2025-Q4")), 1n);
  assert.equal(BigInt(periodOrdinal("daily", "2024-03-01")) - BigInt(periodOrdinal("daily", "2024-02-28")), 2n);
  assert.equal(periodOrdinal("daily", "1970-01-01"), "0");
  for (const period of ["2025-02-29", "1900-02-29", "2026-04-31", "2026-00-01", "2026-01-00", "0000-01-01", "2026-1-01"]) assert.throws(() => periodOrdinal("daily", period), /InvalidPeriod/);
  assert.throws(() => periodOrdinal("monthly", "2026-13"), /InvalidPeriod/);
  assert.throws(() => periodOrdinal("quarterly", "2026-Q5"), /InvalidPeriod/);
  assert.doesNotThrow(() => periodOrdinal("daily", "2000-02-29"));
});

test("incomplete and duplicate matrices cannot silently change weights", () => {
  const incomplete = fixture();
  incomplete.countries[0]!.indicators.pop();
  assert.throws(() => compileMethodology(incomplete), /IncompleteIndicatorMatrix/);
  const duplicate = fixture();
  duplicate.countries[0]!.indicators[1] = duplicate.countries[0]!.indicators[0]!;
  assert.throws(() => compileMethodology(duplicate), /IncompleteIndicatorMatrix/);
  const countries = fixture();
  countries.countries[1] = countries.countries[0]!;
  assert.throws(() => compileMethodology(countries), /DuplicateCountry/);
  const one = fixture();
  one.countries.length = 1;
  assert.throws(() => compileMethodology(one), /InvalidCountryCount/);
});

test("invalid rules fail closed including double-transformed CPI", () => {
  for (const [mutate, pattern] of [
    [(p: MethodologyPolicy) => { p.multiplier = 0; }, /InvalidMultiplier/],
    [(p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.weight = 0; }, /InvalidWeight/],
    [(p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.sourceAuthority = 10001; }, /InvalidSourceAuthority/],
    [(p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.freshness.zeroSeconds = 0; }, /InvalidFreshness/],
    [(p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.comparisonPeriodDelta = 0; }, /InvalidComparisonPeriod/],
    [(p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.normalization = { kind: "target", target: "1", distance: "0" }; }, /InvalidNormalization/],
    [(p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.normalization = { kind: "directional", lower: "1", upper: "1", direction: 1 }; }, /InvalidNormalization/],
    [(p: MethodologyPolicy) => { p.countries[0]!.indicators[0]!.rationale = ""; }, /MissingRationale/],
    [(p: MethodologyPolicy) => { p.countries[0]!.indicators[3]!.transform = "FractionalChange"; }, /CpiAlreadyYearOnYear/],
  ] as const) {
    const policy = fixture();
    mutate(policy);
    assert.throws(() => compileMethodology(policy), pattern);
  }
});

test("maximum country universe compiles all six policies", () => {
  const policy = fixture();
  const template = policy.countries[0]!.indicators;
  policy.countries = COUNTRIES.map(([country]) => ({ country, indicators: structuredClone(template) }));
  const output = compileMethodology(policy);
  assert.equal(output.configuration.countries.length, 30);
  assert.equal(output.configuration.countries.reduce((n, c) => n + c.indicators.length, 0), 180);
});
