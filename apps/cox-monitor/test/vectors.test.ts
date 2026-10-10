import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ClassState, type PoolRequest, executeBatch, revalue } from "../src/pool.js";
import { computeReference } from "../src/reference.js";
import { type WirePrice, encodePrice, encodeSnapshot, priceDigest, snapshotDigest } from "../src/wire.js";

interface RawClass {
  backing: string;
  units: string;
}

interface RawRequest {
  id: string;
  kind: "deposit" | "redeem" | "switch";
  from?: number;
  to?: number;
  amount?: string;
  units?: string;
  minimum: string;
  expiry: number;
}

interface RawPrice {
  assetId: string;
  venue: number;
  step: number;
  candleStart: string;
  priceE8: string;
  tradeAgeMinutes: number;
}

interface Case {
  name: string;
  kind: "reference" | "revalue" | "batch";
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

const vectors = JSON.parse(readFileSync(new URL("../../../packages/cox/fixtures/vectors.json", import.meta.url), "utf8")) as {
  schema: string;
  wire: {
    prices: { input: RawPrice; bytes: string; digest: string }[];
    snapshot: { cutoff: string; roster: string[]; bytes: string; digest: string };
  };
  cases: Case[];
};

const integers = (values: unknown): bigint[] => (values as string[]).map((value) => BigInt(value));
const classes = (values: unknown): ClassState[] => (values as RawClass[]).map((value) => ({ backing: BigInt(value.backing), units: BigInt(value.units) }));
const price = (raw: RawPrice): WirePrice => ({ ...raw, candleStart: BigInt(raw.candleStart), priceE8: BigInt(raw.priceE8) });

function request(raw: RawRequest): PoolRequest {
  const shared = { id: raw.id, minimum: BigInt(raw.minimum), expiry: raw.expiry };
  if (raw.kind === "deposit") return { ...shared, kind: "deposit", to: raw.to!, amount: BigInt(raw.amount!) };
  if (raw.kind === "redeem") return { ...shared, kind: "redeem", from: raw.from!, units: BigInt(raw.units!) };
  return { ...shared, kind: "switch", from: raw.from!, to: raw.to!, units: BigInt(raw.units!) };
}

function plain(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

const select = (kind: Case["kind"]) => vectors.cases.filter((item) => item.kind === kind);

describe("published vectors", () => {
  it("is the vector schema this monitor was written against", () => {
    expect(vectors.schema).toBe("COX/VECTORS/V1");
    expect(vectors.cases.map((item) => item.kind).sort()).toEqual(["batch", "batch", "batch", "batch", "batch", "batch", "reference", "reference", "revalue"]);
  });

  it.each(select("reference"))("reference: $name", ({ input, output }) => {
    const result = computeReference({
      previousPrices: integers(input.previous),
      currentPrices: integers(input.current),
      originPrices: integers(input.origin),
      previousBenchmark: BigInt(input.previousBenchmark as string),
    });
    expect(
      plain({
        gross: result.assetGrowth,
        benchmarkGross: result.benchmarkGrowth,
        benchmark: result.benchmark,
        relative: result.references,
        h: result.transferFactors,
      }),
    ).toEqual(output);
  });

  it.each(select("revalue"))("revaluation: $name", ({ input, output }) => {
    expect(plain(revalue(classes(input.classes), integers(input.h)))).toEqual(output);
  });

  it.each(select("batch"))("batch: $name", ({ input, output }) => {
    const result = executeBatch(classes(input.classes), (input.requests as RawRequest[]).map(request), input.publicationBatch as number);
    expect(plain(result)).toEqual(output);
  });

  it.each(vectors.wire.prices)("price bytes and digest: $input.assetId", ({ input, bytes, digest }) => {
    expect(encodePrice(price(input)).toString("hex")).toBe(bytes);
    expect(priceDigest(price(input))).toBe(digest);
  });

  it("snapshot bytes and digest", () => {
    const { cutoff, roster, bytes, digest } = vectors.wire.snapshot;
    const prices = vectors.wire.prices.map((item) => price(item.input));
    expect(encodeSnapshot(BigInt(cutoff), roster, prices).toString("hex")).toBe(bytes);
    expect(snapshotDigest(BigInt(cutoff), roster, prices)).toBe(digest);
  });
});
