import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileMethodology, compileConfidence, CONFIDENCE_FACTORS, COUNTRIES, periodOrdinal, seriesDescriptor, seriesIdentity, type ConfidenceAssessment, type MethodologyPolicy } from "../../../packages/methodology/src/index.js";
import { adaptEvidence, buildSlots, encodeRule, type Configuration } from "../src/codec.js";
import { assertReady, sha256 } from "../src/provider.js";
import { rustPreview } from "../src/preview.js";
import type { EvidenceRecord } from "../src/types.js";

const published = 1_790_000_000;
async function scenario() {
  const policy = JSON.parse(await readFile(new URL("../../../packages/methodology/fixtures/synthetic-policy.json", import.meta.url), "utf8")) as MethodologyPolicy;
  const unemployment = policy.countries[0]!.indicators.find(i => i.indicator === "unemployment_rate")!;
  unemployment.transform = "Difference";
  unemployment.comparisonPeriodDelta = 1;
  unemployment.normalization = { kind: "directional", lower: "-2", upper: "2", direction: -1 };
  const configuration: Configuration = compileMethodology(policy).configuration;
  const records: EvidenceRecord[] = [];
  for (const country of policy.countries) {
    for (const indicator of country.indicators) {
      const descriptor = seriesDescriptor(country.country, indicator.indicator);
      const period = periodOrdinal(descriptor.frequency, descriptor.frequency === "daily" ? "2026-09-01" : descriptor.frequency === "monthly" ? "2026-09" : "2026-Q3");
      const record: EvidenceRecord = {
        recordId: `${country.country}/${indicator.indicator}/current`,
        seriesId: seriesIdentity(country.country, indicator.indicator), revisionId: "synthetic-edition-1",
        country: COUNTRIES.find(([id]) => id === country.country)![1], indicator: indicator.indicator,
        source: descriptor.source, unit: descriptor.unit, period,
        value: indicator.transform === "Identity" ? "2" : "100",
        publishedAt: published, knownAt: null, recordedAt: published,
        artifactDigest: sha256("synthetic methodology integration evidence"), manifest: "synthetic-only",
        confidenceBps: [indicator.sourceAuthority, 10000, 10000, 10000, 10000, 10000, 10000, 10000],
      };
      if (indicator.transform !== "Identity") {
        const comparisonRecordId = `${country.country}/${indicator.indicator}/comparison`;
        records.push({ ...record, recordId: comparisonRecordId, period: String(BigInt(period) - BigInt(indicator.comparisonPeriodDelta)) });
        record.comparisonRecordId = comparisonRecordId;
      }
      assertReady(record, published);
      records.push(record);
    }
  }
  const slots = buildSlots(configuration, records);
  return {
    evaluation_time: published, multiplier: configuration.multiplier, baseline: null as number[] | null,
    countries: configuration.countries.map((country, index) => ({
      id: country.id, rules: country.indicators.map(i => i.rule), slots: slots[index]!,
      histories: country.indicators.map(() => [{ pending: 0, rejected: 0 }, { pending: 0, rejected: 0 }]),
    })),
  };
}

test("compiled methodology matches worker identities and serializes every rule", async () => {
  const input = await scenario();
  assert.equal(input.countries.length, 3);
  for (const country of input.countries) {
    assert.equal(country.rules.length, 6);
    country.rules.forEach((rule, index) => {
      const slot = country.slots[index]!;
      assert.ok(encodeRule(rule).length > 0);
      for (const key of ["source", "unit", "series_id"] as const) assert.deepEqual(rule[key], slot.current[key]);
      if (slot.comparison) assert.equal(BigInt(slot.current.period) - BigInt(slot.comparison.period), BigInt(rule.comparison_period_delta));
    });
  }
});

test("compiled six-indicator policy executes in Rust with stable confidence-only economics", { skip: !process.env.EOX_RUST_CLI }, async () => {
  const input = await scenario();
  const initial = await rustPreview(process.env.EOX_RUST_CLI!, input);
  assert.ok(initial.references.every(reference => reference.expressed === 100_000_000));
  assert.ok(initial.countries.every(country => country.confidence === 1_000_000));
  input.baseline = initial.countries.map(country => country.state);
  input.evaluation_time += 60 * 86400;
  const aged = await rustPreview(process.env.EOX_RUST_CLI!, input);
  assert.deepEqual(aged.countries.map(c => c.state), initial.countries.map(c => c.state));
  assert.equal(aged.world.state, initial.world.state);
  assert.ok(aged.countries.every(country => country.confidence === 500_000));
  assert.ok(aged.references.every(reference => reference.expressed === 100_000_000));
  input.countries[0]!.slots[0]!.current.period = "0";
  await assert.rejects(rustPreview(process.env.EOX_RUST_CLI!, input), /InvalidPeriod/);
});

test("provenance-bound confidence assertions fit worker evidence and Rust confidence math", { skip: !process.env.EOX_RUST_CLI }, async () => {
  const input = await scenario();
  const original = await rustPreview(process.env.EOX_RUST_CLI!, input);
  const country = input.countries.find(country => country.id === "US")!;
  const slot = country.slots[0]!;
  const assessment: ConfidenceAssessment = {
    recordId: "synthetic-confidence-record", artifactDigest: sha256("synthetic-payload"), sourceId: "imf-portwatch", assessorId: "fixture-assessor", rubricDigest: sha256("synthetic-rubric"),
    factors: Object.fromEntries(CONFIDENCE_FACTORS.map(factor => [factor, {
      basisPoints: factor === "sourceAuthority" ? 10000 : 9000,
      rationale: "Synthetic rating only", supportingDigests: [sha256(`synthetic-proof:${factor}`)],
    }])) as ConfidenceAssessment["factors"],
  };
  const compiled = compileConfidence(assessment, { sourceId: assessment.sourceId, authorityBasisPoints: country.rules[0]!.source_authority, policyDigest: sha256("synthetic-source-policy") });
  const record: EvidenceRecord = {
    recordId: assessment.recordId, artifactDigest: assessment.artifactDigest,
    source: assessment.sourceId, seriesId: seriesIdentity("USA", "container_throughput"),
    country: "US", indicator: "container_throughput", unit: "metric_tonnes", revisionId: "synthetic-edition-1",
    period: String(slot.current.period), value: "100", publishedAt: published, knownAt: null, recordedAt: published,
    manifest: compiled.canonicalManifest, confidenceBps: compiled.confidenceBps,
  };
  assertReady(record, published);
  const encoded = adaptEvidence(record);
  assert.notDeepEqual(encoded.metadata_digest, adaptEvidence({ ...record, manifest: "different-provenance" }).metadata_digest);
  slot.current = encoded;
  const output = await rustPreview(process.env.EOX_RUST_CLI!, input);
  assert.deepEqual(output.countries.map(c => c.state), original.countries.map(c => c.state));
  assert.equal(output.world.state, original.world.state);
  const index = input.countries.findIndex(country => country.id === "US");
  assert.ok(output.countries[index]!.confidence < original.countries[index]!.confidence);
});
