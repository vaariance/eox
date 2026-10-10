import { SCALE, round } from "./index.ts";
export interface ClassState { backing: bigint; units: bigint }
export type Request =
  | { id: string; kind: "deposit"; to: number; amount: bigint; minimum: bigint; expiry: number }
  | { id: string; kind: "redeem"; from: number; units: bigint; minimum: bigint; expiry: number }
  | { id: string; kind: "switch"; from: number; to: number; units: bigint; minimum: bigint; expiry: number };
const MAX = (1n << 127n) - 1n;
export function checked(value: bigint): bigint {
  if (value < -MAX - 1n || value > MAX) throw new Error("ArithmeticOverflow");
  return value;
}
const mul = (a: bigint, b: bigint) => checked(a * b);
export function reference(previous: readonly bigint[], current: readonly bigint[], origin: readonly bigint[], previousBenchmark: bigint) {
  if (previous.length < 2 || previous.length !== current.length || previous.length !== origin.length || [...previous, ...current, ...origin, previousBenchmark].some(value => value <= 0n)) throw new Error("InvalidReferenceInput");
  const gross = current.map((value, i) => round(mul(value, SCALE), previous[i]!));
  const benchmarkGross = round(gross.reduce((sum, value) => checked(sum + value), 0n), BigInt(gross.length));
  const benchmark = round(mul(previousBenchmark, benchmarkGross), SCALE);
  if (benchmark <= 0n) throw new Error("InvalidBenchmark");
  const assetLevels = current.map((value, i) => round(mul(value, SCALE), origin[i]!));
  const benchmarkLevel = round(mul(benchmark, SCALE), 100n * SCALE);
  if (benchmarkLevel <= 0n) throw new Error("InvalidBenchmark");
  const relative = assetLevels.map(level => round(mul(100n * SCALE, level), benchmarkLevel));
  const h = gross.map(value => round(mul(value, SCALE), benchmarkGross));
  return { gross, benchmarkGross, benchmark, relative, h: [...h, SCALE] };
}
export function revalue(classes: readonly ClassState[], h: readonly bigint[]) {
  if (classes.length !== h.length || h.some(value => value < 0n) || classes.some(value => value.backing < 0n || value.units < 0n || (value.units === 0n && value.backing !== 0n))) throw new Error("InvalidClassState");
  const total = classes.reduce((sum, value) => checked(sum + value.backing), 0n);
  if (total === 0n) return { classes: classes.map(value => ({ ...value })), residual: 0n };
  const scores = classes.map((value, i) => mul(value.backing, h[i]!));
  const denominator = scores.reduce((sum, value) => checked(sum + value), 0n);
  if (denominator === 0n) throw new Error("ZeroTransferDenominator");
  const result = classes.map((value, i) => ({ units: value.units, backing: mul(total, scores[i]!) / denominator }));
  return { classes: result, residual: total - result.reduce((sum, value) => sum + value.backing, 0n) };
}
export function batch(classes: readonly ClassState[], requests: readonly Request[], publicationBatch: number) {
  const reserved = classes.map(() => 0n);
  for (const request of requests) {
    if (request.kind !== "deposit") {
      if (!classes[request.from] || request.units <= 0n) throw new Error("InvalidReservation");
      reserved[request.from]! += request.units;
      if (reserved[request.from]! > classes[request.from]!.units) throw new Error("OverReservedUnits");
    }
  }
  const deltas = classes.map(() => 0n);
  let acceptedDeposits = 0n;
  let payable = 0n;
  let refunds = 0n;
  const receipts = requests.map(request => {
    if (request.kind !== "deposit") {
      if (!classes[request.from] || request.units <= 0n) throw new Error("InvalidReservation");
    }
    if (request.kind !== "redeem" && (!classes[request.to] || (request.kind === "switch" && request.to === request.from))) throw new Error("InvalidDestination");
    if (request.kind === "deposit" && request.amount <= 0n) throw new Error("InvalidAmount");
    let outcome = publicationBatch > request.expiry ? "Expired" : "Filled";
    const source = request.kind === "deposit" ? null : classes[request.from]!;
    const proceeds = source === null ? 0n : mul(request.kind === "deposit" ? 0n : request.units, source.backing) / source.units;
    const input = request.kind === "deposit" ? request.amount : proceeds;
    const destination = request.kind === "redeem" ? null : classes[request.to]!;
    let minted = 0n;
    if (destination !== null && outcome === "Filled") {
      if (destination.units > 0n && destination.backing === 0n) outcome = "ZeroValueClass";
      else minted = destination.units === 0n ? mul(input, SCALE) : mul(input, destination.units) / destination.backing;
    }
    const output = request.kind === "redeem" ? proceeds : minted;
    if (outcome === "Filled" && ((request.kind !== "redeem" && output === 0n) || output < request.minimum)) outcome = "ConditionFailed";
    if (outcome !== "Filled") {
      if (request.kind === "deposit") refunds += request.amount;
      return { id: request.id, outcome, minted: 0n, proceeds: 0n };
    }
    if (request.kind !== "deposit") deltas[request.from]! -= request.units;
    else acceptedDeposits += request.amount;
    if (request.kind !== "redeem") deltas[request.to]! += minted;
    else payable += proceeds;
    return { id: request.id, outcome, minted, proceeds: request.kind === "deposit" ? 0n : proceeds };
  });
  const result = classes.map((value, i) => {
    const units = checked(value.units + deltas[i]!);
    if (units < 0n) throw new Error("OverReservedUnits");
    const backing = value.units === 0n ? units / SCALE : mul(units, value.backing) / value.units;
    return { units, backing };
  });
  const before = classes.reduce((sum, value) => sum + value.backing, 0n);
  const after = result.reduce((sum, value) => sum + value.backing, 0n);
  const residual = before + acceptedDeposits - payable - after;
  if (residual < 0n) throw new Error("InsolventBatch");
  return { classes: result, payable, refunds, residual, receipts };
}
