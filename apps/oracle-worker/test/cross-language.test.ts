import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { rustPreview } from "../src/preview.js";
import { integer, type Rule, type Slot, type MathEvidence } from "../src/codec.js";

const Q = 1_000_000n;
function rounded(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("InvalidDenominator");
  const remainder = n % d;
  return n / d + (2n * (remainder < 0n ? -remainder : remainder) >= d ? (n < 0n ? -1n : 1n) : 0n);
}
const min = (a: bigint, b: bigint) => a < b ? a : b;
const max = (a: bigint, b: bigint) => a > b ? a : b;
type History = { pending: number; rejected: number };
interface Input {
  evaluation_time: number; multiplier: number; baseline: number[] | null;
  countries: { rules: Rule[]; slots: Slot[]; histories: [History, History][] }[];
}
function confidence(rule: Rule, evidence: MathEvidence, history: History, time: number) {
  let quality = Q;
  for (const factor of evidence.quality) quality = rounded(quality * BigInt(factor), 10_000n);
  const age = BigInt(time) - integer(evidence.published_at!);
  const grace = integer(rule.grace_seconds), zero = integer(rule.zero_seconds);
  const freshness = age <= grace ? Q : age >= zero ? 0n : rounded((zero - age) * Q, zero - grace);
  const dispute = max(0n, Q - min(200_000n, BigInt(history.rejected) * 50_000n) - min(800_000n, BigInt(history.pending) * 200_000n));
  return rounded(rounded(quality * freshness, Q) * dispute, Q);
}
function independent(input: Input) {
  const countries = input.countries.map(country => {
    let sum = 0n, weight = 0n, trust = 0n;
    country.rules.forEach((rule, index) => {
      const slot = country.slots[index]!, histories = country.histories[index]!;
      const current = integer(slot.current.value), comparison = slot.comparison ? integer(slot.comparison.value) : 0n;
      const x = rule.transform === "Identity" ? current : rule.transform === "Difference" ? current - comparison : rounded((current - comparison) * Q, comparison);
      let normalized: bigint;
      if ("Directional" in rule.normalization) {
        const {lower, upper, direction} = rule.normalization.Directional;
        normalized = BigInt(direction) * (rounded(2n * (x - integer(lower)) * Q, integer(upper) - integer(lower)) - Q);
      } else {
        const {target, distance} = rule.normalization.Target;
        const delta = x - integer(target);
        normalized = Q - rounded(2n * (delta < 0n ? -delta : delta) * Q, integer(distance));
      }
      let certainty = confidence(rule, slot.current, histories[0], input.evaluation_time);
      if (slot.comparison) certainty = min(certainty, confidence(rule, slot.comparison, histories[1], input.evaluation_time));
      const w = BigInt(rule.weight);
      sum += min(Q, max(-Q, normalized)) * w; trust += certainty * w; weight += w;
    });
    return {state: 100n * Q + 50n * rounded(sum, weight), confidence: rounded(trust, weight)};
  });
  const world = {state: rounded(countries.reduce((sum, c) => sum + c.state, 0n), BigInt(countries.length)), confidence: rounded(countries.reduce((sum, c) => sum + c.confidence, 0n), BigInt(countries.length))};
  const baseline = input.baseline?.map(BigInt) ?? countries.map(c => c.state);
  const world0 = rounded(baseline.reduce((sum, n) => sum + n, 0n), BigInt(baseline.length));
  const references = countries.map((country, index) => {
    const denominator = world.state * baseline[index]!;
    const numerator = country.state * world0 - denominator;
    return {ratio: rounded(country.state * Q, world.state), change: rounded(numerator * Q, denominator), expressed: rounded(100n * Q * (denominator + BigInt(input.multiplier) * numerator), denominator), confidence: min(country.confidence, world.confidence)};
  });
  return {countries, world, references};
}
for (const name of ["baseline", "us-improves", "confidence-decay", "contested"]) {
  test(`independent bigint calculation matches Rust: ${name}`, {skip: !process.env.EOX_RUST_CLI}, async () => {
    const input = JSON.parse(await readFile(new URL(`../../../packages/oracle/fixtures/${name}.json`, import.meta.url), "utf8")) as Input;
    // Exercise nontrivial quality multiplication as well as the fixture's transforms.
    input.countries[0]!.slots[0]!.current.quality = [10_000, 9341, 8973, 9567, 8765, 9234, 9888, 9123];
    const expected = independent(input);
    const actual = await rustPreview(process.env.EOX_RUST_CLI!, input);
    actual.countries.forEach((country, i) => {
      assert.equal(BigInt(country.state), expected.countries[i]!.state);
      assert.equal(BigInt(country.confidence), expected.countries[i]!.confidence);
      for (const field of ["ratio", "change", "expressed", "confidence"] as const) assert.equal(BigInt(actual.references[i]![field]), expected.references[i]![field]);
    });
    assert.equal(BigInt(actual.world.state), expected.world.state);
    assert.equal(BigInt(actual.world.confidence), expected.world.confidence);
  });
}
