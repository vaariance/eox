import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { compileMethodology, exactFixed, periodOrdinal, type MethodologyPolicy } from "../src/index.js";
import { encodePreview, rustPreview } from "../../../apps/oracle-worker/src/preview.js";
import type { Slot } from "../../../apps/oracle-worker/src/codec.js";

const binary = process.env.EOX_RUST_CLI;
if (!binary) throw new Error("EOX_RUST_CLI is required; no simulated calculator fallback");
const outputDirectory = process.argv[2];
if (!outputDirectory) throw new Error("Usage: sensitivity.ts OUTPUT_DIRECTORY");
const policy = JSON.parse(await readFile(new URL("../fixtures/synthetic-policy.json", import.meta.url), "utf8")) as MethodologyPolicy;
policy.version = "six-indicator-sensitivity-not-calibrated-v1";
policy.epochId = policy.version;
for (const country of policy.countries) {
  for (const item of country.indicators) {
    item.rationale = "Hypothetical sensitivity control only; no economic calibration or target endorsement.";
    if (item.indicator === "container_throughput") {
      item.comparisonPeriodDelta = 364;
      item.normalization = { kind: "directional", lower: "-0.5", upper: "0.5", direction: 1 };
      item.freshness = { graceSeconds: 7 * 86400, zeroSeconds: 30 * 86400 };
    } else if (item.indicator === "gdp_real_volume" || item.indicator === "residential_property_price_real") {
      item.comparisonPeriodDelta = 4;
      item.freshness = { graceSeconds: 120 * 86400, zeroSeconds: 270 * 86400 };
      if (item.indicator === "residential_property_price_real") item.normalization = { kind: "target", target: "0", distance: "0.2" };
    } else {
      item.freshness = country.country === "NZL" && item.indicator !== "policy_rate"
        ? { graceSeconds: 120 * 86400, zeroSeconds: 270 * 86400 }
        : { graceSeconds: 45 * 86400, zeroSeconds: 120 * 86400 };
      item.normalization = { kind: "target", target: "2", distance: "4" };
      if (item.indicator === "unemployment_rate") {
        item.transform = "Difference";
        item.comparisonPeriodDelta = country.country === "NZL" ? 4 : 12;
        item.normalization = { kind: "directional", lower: "-2", upper: "2", direction: -1 };
      }
    }
  }
}
const compiled = compileMethodology(policy);
const evaluation = 1_790_000_000;
const digest = (text: string) => [...createHash("sha256").update(text).digest()];
const countries = compiled.configuration.countries.map(country => ({
  id: country.id, rules: country.indicators.map(i => i.rule),
  slots: country.indicators.map(({ id, rule }): Slot => {
    const frequency = id === "container_throughput" ? "daily"
      : id === "gdp_real_volume" || id === "residential_property_price_real" || (country.id === "NZ" && id !== "policy_rate") ? "quarterly" : "monthly";
    const period = periodOrdinal(frequency, frequency === "daily" ? "2026-09-01" : frequency === "quarterly" ? "2026-Q3" : "2026-09");
    const evidence = {
      record_id: digest(`${country.id}/${id}/current`), series_id: rule.series_id, unit: rule.unit, source: rule.source,
      artifact_digest: digest("synthetic-artifact"), metadata_digest: digest("synthetic-only"),
      value: exactFixed(id === "unemployment_rate" ? "5" : rule.transform === "Identity" ? "2" : "100"),
      published_at: evaluation, known_at: null, recorded_at: evaluation, period, quality: Array<number>(8).fill(10000),
    };
    return { current: evidence, comparison: rule.transform === "Identity" ? null : {
      ...evidence, record_id: digest(`${country.id}/${id}/comparison`), period: String(BigInt(period) - BigInt(rule.comparison_period_delta)),
    } };
  }),
  histories: country.indicators.map(() => [{ pending: 0, rejected: 0 }, { pending: 0, rejected: 0 }]),
}));
const initial = { evaluation_time: evaluation, multiplier: policy.multiplier, baseline: null as number[] | null, countries };
const baseline = await rustPreview(binary, initial);
assert.ok(baseline.references.every(r => r.expressed === 100_000_000));
const template = { ...initial, baseline: baseline.countries.map(c => c.state) };
type Input = typeof template;
function us(input: Input) { return input.countries.find(c => c.id === "US")!; }
const scenarios: { name: string; mutate: (input: Input) => void }[] = [
  { name: "us-gdp-growth-plus-one-percentage-point", mutate: input => { us(input).slots[2]!.current.value = exactFixed("101"); } },
  { name: "us-port-day-plus-twenty-percent", mutate: input => { us(input).slots[0]!.current.value = exactFixed("120"); } },
  { name: "us-property-growth-plus-ten-percent", mutate: input => { us(input).slots[1]!.current.value = exactFixed("110"); } },
  { name: "us-core-inflation-two-to-three", mutate: input => { us(input).slots[3]!.current.value = exactFixed("3"); } },
  { name: "us-unemployment-five-to-four", mutate: input => { us(input).slots[4]!.current.value = exactFixed("4"); } },
  { name: "us-policy-rate-two-to-three", mutate: input => { us(input).slots[5]!.current.value = exactFixed("3"); } },
  { name: "us-policy-rate-two-to-one", mutate: input => { us(input).slots[5]!.current.value = exactFixed("1"); } },
  { name: "year-old-comparisons-original-publication", mutate: input => {
    for (const country of input.countries) for (const slot of country.slots) if (slot.comparison) slot.comparison.published_at = evaluation - 365 * 86400;
  } },
  { name: "confidence-only-after-sixty-days", mutate: input => { input.evaluation_time += 60 * 86400; } },
  { name: "us-gdp-beyond-upper-anchor", mutate: input => { us(input).slots[2]!.current.value = exactFixed("120"); } },
];
const results = [];
for (const scenario of scenarios) {
  const input = structuredClone(template);
  scenario.mutate(input);
  const output = await rustPreview(binary, input);
  if (scenario.name.includes("confidence-only") || scenario.name.includes("year-old")) {
    assert.deepEqual(output.countries.map(c => c.state), baseline.countries.map(c => c.state));
    assert.ok(output.references.every(r => r.expressed === 100_000_000));
    assert.ok(output.countries.some(c => c.confidence < 1_000_000));
  }
  results.push({ name: scenario.name, input, output });
}
const up = results.find(r => r.name === "us-policy-rate-two-to-three")!;
const down = results.find(r => r.name === "us-policy-rate-two-to-one")!;
assert.deepEqual(up.output.countries, down.output.countries);
assert.deepEqual(up.output.world, down.output.world);
assert.deepEqual(up.output.references, down.output.references);
const index = compiled.configuration.countries.findIndex(c => c.id === "US");
assert.ok(results[0]!.output.references[index]!.expressed > 100_000_000);
assert.ok(results[9]!.output.countries[index]!.saturated);
const further = structuredClone(results[9]!.input);
us(further).slots[2]!.current.value = exactFixed("130");
assert.deepEqual((await rustPreview(binary, further)).references, results[9]!.output.references);
assert.ok(results[7]!.output.countries.every(c => c.confidence === 333333));
const out = resolve(outputDirectory);
await mkdir(out, { recursive: true });
await writeFile(join(out, "sensitivity.json"), JSON.stringify({
  status: "synthetic-sensitivity-not-empirical-calibration", scale: 1000000,
  binarySha256: createHash("sha256").update(await readFile(binary)).digest("hex"),
  policy, manifestDigest: compiled.manifestDigest, countries: compiled.configuration.countries.map(c => c.id),
  baseline: { inputSha256: createHash("sha256").update(encodePreview(initial)).digest("hex"), output: baseline },
  scenarios: results.map(({ name, input, output }) => ({ name, inputSha256: createHash("sha256").update(encodePreview(input)).digest("hex"), output })),
}, null, 2) + "\n");
console.log(JSON.stringify(results.map(r => ({ scenario: r.name, usState: r.output.countries[index]!.state / 1e6, usWorldReference: r.output.references[index]!.expressed / 1e6, usConfidence: r.output.countries[index]!.confidence / 1e6 })), null, 2));
