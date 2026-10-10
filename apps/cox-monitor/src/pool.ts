import { SCALE, divideDown, fail, plus, sum, times } from "./arithmetic.js";

export interface ClassState {
  backing: bigint;
  units: bigint;
}

export interface Revaluation {
  classes: ClassState[];
  residual: bigint;
}

export type PoolRequest =
  | { id: string; kind: "deposit"; to: number; amount: bigint; minimum: bigint; expiry: number }
  | { id: string; kind: "redeem"; from: number; units: bigint; minimum: bigint; expiry: number }
  | { id: string; kind: "switch"; from: number; to: number; units: bigint; minimum: bigint; expiry: number };

export type Outcome = "Filled" | "Expired" | "ZeroValueClass" | "ConditionFailed";

export interface Receipt {
  id: string;
  outcome: Outcome;
  minted: bigint;
  proceeds: bigint;
}

export interface BatchResult {
  classes: ClassState[];
  payable: bigint;
  refunds: bigint;
  residual: bigint;
  receipts: Receipt[];
}

function checkClasses(classes: readonly ClassState[]): void {
  for (const state of classes) {
    if (state.backing < 0n || state.units < 0n) fail("InvalidClassState");
    if (state.units === 0n && state.backing !== 0n) fail("InvalidClassState");
  }
}

export function revalue(classes: readonly ClassState[], transferFactors: readonly bigint[]): Revaluation {
  if (classes.length !== transferFactors.length) fail("InvalidClassState");
  if (transferFactors.some((factor) => factor < 0n)) fail("InvalidClassState");
  checkClasses(classes);

  const pool = sum(classes.map((state) => state.backing));
  if (pool === 0n) return { classes: classes.map((state) => ({ ...state })), residual: 0n };

  const weights = classes.map((state, index) => times(state.backing, transferFactors[index]!));
  const totalWeight = sum(weights);
  if (totalWeight === 0n) fail("ZeroTransferDenominator");

  const revalued = classes.map((state, index) => ({
    backing: divideDown(times(pool, weights[index]!), totalWeight),
    units: state.units,
  }));
  return { classes: revalued, residual: pool - sum(revalued.map((state) => state.backing)) };
}

function sourceOf(request: PoolRequest): number | null {
  return request.kind === "deposit" ? null : request.from;
}

function destinationOf(request: PoolRequest): number | null {
  return request.kind === "redeem" ? null : request.to;
}

function checkRequests(classes: readonly ClassState[], requests: readonly PoolRequest[]): void {
  const locked = classes.map(() => 0n);
  for (const request of requests) {
    const source = sourceOf(request);
    const destination = destinationOf(request);
    if (request.kind === "deposit") {
      if (request.amount <= 0n) fail("InvalidAmount");
    } else {
      if (source === null || classes[source] === undefined || request.units <= 0n) fail("InvalidReservation");
      locked[source] = plus(locked[source]!, request.units);
      if (locked[source]! > classes[source]!.units) fail("OverReservedUnits");
    }
    if (destination !== null && (classes[destination] === undefined || destination === source)) fail("InvalidDestination");
  }
}

function settle(classes: readonly ClassState[], request: PoolRequest, publicationBatch: number): Receipt {
  const rejected = (outcome: Outcome): Receipt => ({ id: request.id, outcome, minted: 0n, proceeds: 0n });
  if (publicationBatch > request.expiry) return rejected("Expired");

  let proceeds = 0n;
  if (request.kind !== "deposit") {
    const source = classes[request.from]!;
    proceeds = divideDown(times(request.units, source.backing), source.units);
  }

  let minted = 0n;
  if (request.kind !== "redeem") {
    const destination = classes[request.to]!;
    const collateral = request.kind === "deposit" ? request.amount : proceeds;
    if (destination.units === 0n) minted = times(collateral, SCALE);
    else if (destination.backing === 0n) return rejected("ZeroValueClass");
    else minted = divideDown(times(collateral, destination.units), destination.backing);
    if (minted === 0n || minted < request.minimum) return rejected("ConditionFailed");
  } else if (proceeds < request.minimum) {
    return rejected("ConditionFailed");
  }

  return { id: request.id, outcome: "Filled", minted, proceeds };
}

export function executeBatch(classes: readonly ClassState[], requests: readonly PoolRequest[], publicationBatch: number): BatchResult {
  checkClasses(classes);
  checkRequests(classes, requests);

  const receipts = requests.map((request) => settle(classes, request, publicationBatch));
  const unitChange = classes.map(() => 0n);
  let deposited = 0n;
  let payable = 0n;
  let refunds = 0n;

  requests.forEach((request, index) => {
    const receipt = receipts[index]!;
    if (receipt.outcome !== "Filled") {
      if (request.kind === "deposit") refunds = plus(refunds, request.amount);
      return;
    }
    if (request.kind === "deposit") deposited = plus(deposited, request.amount);
    else unitChange[request.from] = unitChange[request.from]! - request.units;
    if (request.kind === "redeem") payable = plus(payable, receipt.proceeds);
    else unitChange[request.to] = plus(unitChange[request.to]!, receipt.minted);
  });

  const after = classes.map((state, index) => {
    const units = plus(state.units, unitChange[index]!);
    if (units < 0n) fail("OverReservedUnits");
    const backing = state.units === 0n ? divideDown(units, SCALE) : divideDown(times(units, state.backing), state.units);
    return { backing, units };
  });

  const backingBefore = sum(classes.map((state) => state.backing));
  const backingAfter = sum(after.map((state) => state.backing));
  const residual = backingBefore + deposited - payable - backingAfter;
  if (residual < 0n) fail("InsolventBatch");

  return { classes: after, payable, refunds, residual, receipts };
}
