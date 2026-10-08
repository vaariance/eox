import { createHash } from "node:crypto";
import { COUNTRIES, INDICATORS, seriesDescriptor, type Country, type Indicator } from "./catalogue.js";
export * from "./catalogue.js";
export * from "./period.js";
export * from "./research.js";
export * from "./confidence.js";

export type Transform = "Identity" | "Difference" | "FractionalChange";
export type Normalization = { kind: "directional"; lower: string; upper: string; direction: 1 | -1 } | { kind: "target"; target: string; distance: string };
export interface IndicatorPolicy {
  indicator: Indicator;
  transform: Transform;
  comparisonPeriodDelta: number;
  normalization: Normalization;
  weight: number;
  sourceAuthority: number;
  freshness: { graceSeconds: number; zeroSeconds: number };
  rationale: string;
}
export interface MethodologyPolicy {
  version: string;
  epochId: string;
  multiplier: number;
  countries: { country: Country; indicators: IndicatorPolicy[] }[];
}
export interface OracleRule {
  transform: Transform;
  normalization: { Directional: { lower: string; upper: string; direction: number } } | { Target: { target: string; distance: string } };
  weight: number; unit: number[]; source: number[]; series_id: number[]; source_authority: number;
  comparison_period_delta: string; grace_seconds: string; zero_seconds: string;
}
export interface OracleConfiguration { epochId: string; multiplier: number; countries: { id: string; indicators: { id: string; rule: OracleRule }[] }[] }
export interface CompiledMethodology { manifestDigest: string; canonicalManifest: string; configuration: OracleConfiguration }
const SCALE = 1_000_000n;
const BOUND = 1_000_000_000_000n * SCALE;
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest();
const identity = (value: string) => [...hash(value)];

export function exactFixed(value: string): string {
  if (typeof value !== "string") throw new Error("InvalidDecimal");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error("InvalidDecimal");
  const fraction = match[3] ?? "";
  if (/[1-9]/.test(fraction.slice(6))) throw new Error("ExcessPrecision");
  const scaled = (BigInt(match[2]!) * SCALE + BigInt(fraction.slice(0, 6).padEnd(6, "0"))) * (match[1] === "-" ? -1n : 1n);
  if (scaled < -BOUND || scaled > BOUND) throw new Error("MagnitudeExceeded");
  return scaled.toString();
}

export function gdpMillions(rawValue: string, unitMultiplier: number): string {
  integerIn(unitMultiplier, 0, 6, "InvalidUnitMultiplier");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(rawValue);
  if (!match) throw new Error("InvalidDecimal");
  const fractional = match[3] ?? "";
  if (/[1-9]/.test(fractional.slice(unitMultiplier))) throw new Error("ExcessPrecision");
  const value = (BigInt(match[2]!) * 10n ** BigInt(unitMultiplier) + BigInt(fractional.slice(0, unitMultiplier).padEnd(unitMultiplier, "0") || "0")) * (match[1] === "-" ? -1n : 1n);
  if (value < -BOUND || value > BOUND) throw new Error("MagnitudeExceeded");
  const magnitude = value < 0 ? -value : value;
  return `${value < 0 ? "-" : ""}${magnitude / SCALE}.${(magnitude % SCALE).toString().padStart(6, "0")}`;
}

function integerIn(value: number, lower: number, upper: number, error: string): void {
  if (!Number.isSafeInteger(value) || value < lower || value > upper) throw new Error(error);
}

export function seriesIdentity(country: Country, indicator: Indicator): string {
  const descriptor = seriesDescriptor(country, indicator);
  return `EOX/SERIES/V1:${JSON.stringify([descriptor.country, descriptor.indicator, descriptor.source, descriptor.frequency, descriptor.unit])}`;
}

function compileRule(country: Country, policy: IndicatorPolicy): OracleRule {
  const descriptor = seriesDescriptor(country, policy.indicator);
  if (!["Identity", "Difference", "FractionalChange"].includes(policy.transform)) throw new Error("InvalidTransform");
  if (policy.indicator === "cpi_core_yoy" && policy.transform !== "Identity") throw new Error("CpiAlreadyYearOnYear");
  integerIn(policy.weight, 1, 10_000, "InvalidWeight");
  integerIn(policy.sourceAuthority, 0, 10_000, "InvalidSourceAuthority");
  integerIn(policy.comparisonPeriodDelta, policy.transform === "Identity" ? 0 : 1, policy.transform === "Identity" ? 0 : Number.MAX_SAFE_INTEGER, "InvalidComparisonPeriod");
  integerIn(policy.freshness.graceSeconds, 0, Number.MAX_SAFE_INTEGER, "InvalidFreshness");
  integerIn(policy.freshness.zeroSeconds, policy.freshness.graceSeconds + 1, Number.MAX_SAFE_INTEGER, "InvalidFreshness");
  if (typeof policy.rationale !== "string" || !policy.rationale.trim()) throw new Error("MissingRationale");
  let normalization: OracleRule["normalization"];
  const input = policy.normalization;
  if (input.kind === "directional") {
    const lower = exactFixed(input.lower);
    const upper = exactFixed(input.upper);
    if (BigInt(upper) <= BigInt(lower) || (input.direction !== 1 && input.direction !== -1)) throw new Error("InvalidNormalization");
    normalization = { Directional: { lower, upper, direction: input.direction } };
  } else if (input.kind === "target") {
    const target = exactFixed(input.target);
    const distance = exactFixed(input.distance);
    if (BigInt(distance) <= 0n) throw new Error("InvalidNormalization");
    normalization = { Target: { target, distance } };
  } else throw new Error("InvalidNormalization");
  return {
    transform: policy.transform, normalization, weight: policy.weight,
    unit: identity(descriptor.unit), source: identity(descriptor.source), series_id: identity(seriesIdentity(country, policy.indicator)),
    source_authority: policy.sourceAuthority, comparison_period_delta: String(policy.comparisonPeriodDelta),
    grace_seconds: String(policy.freshness.graceSeconds), zero_seconds: String(policy.freshness.zeroSeconds),
  };
}

export function compileMethodology(policy: MethodologyPolicy): CompiledMethodology {
  if (typeof policy.version !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(policy.version)) throw new Error("InvalidVersion");
  if (typeof policy.epochId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(policy.epochId)) throw new Error("InvalidEpoch");
  integerIn(policy.multiplier, 1, 100, "InvalidMultiplier");
  integerIn(policy.countries.length, 2, 30, "InvalidCountryCount");
  if (new Set(policy.countries.map(country => country.country)).size !== policy.countries.length) throw new Error("DuplicateCountry");
  const ordered = [...policy.countries].sort((a, b) => a.country < b.country ? -1 : a.country > b.country ? 1 : 0);
  const manifestCountries: unknown[] = [];
  const countries = ordered.map(country => {
    const countryCode = COUNTRIES.find(([id]) => id === country.country);
    if (!countryCode) throw new Error("UnknownCountry");
    if (country.indicators.length !== INDICATORS.length || new Set(country.indicators.map(indicator => indicator.indicator)).size !== INDICATORS.length) throw new Error("IncompleteIndicatorMatrix");
    const manifestIndicators: unknown[] = [];
    const indicators = INDICATORS.map(indicator => {
      const input = country.indicators.find(entry => entry.indicator === indicator);
      if (!input) throw new Error("IncompleteIndicatorMatrix");
      const rule = compileRule(country.country, input);
      const descriptor = seriesDescriptor(country.country, indicator);
      const normalization = "Directional" in rule.normalization ? ["directional", rule.normalization.Directional.lower, rule.normalization.Directional.upper, rule.normalization.Directional.direction] : ["target", rule.normalization.Target.target, rule.normalization.Target.distance];
      manifestIndicators.push([indicator, descriptor.source, descriptor.unit, descriptor.frequency, seriesIdentity(country.country, indicator), rule.transform, rule.comparison_period_delta, normalization, rule.weight, rule.source_authority, rule.grace_seconds, rule.zero_seconds, input.rationale]);
      return { id: indicator, rule };
    });
    manifestCountries.push([country.country, countryCode[1], manifestIndicators]);
    return { id: countryCode[1], indicators };
  });
  const canonicalManifest = JSON.stringify(["EOX/METHODOLOGY/V1", policy.version, policy.epochId, "fixed-1e6-nearest-ties-away-v1", "equal-country-world-includes-self", policy.multiplier, manifestCountries]);
  return { manifestDigest: hash(canonicalManifest).toString("hex"), canonicalManifest, configuration: { epochId: policy.epochId, multiplier: policy.multiplier, countries } };
}
