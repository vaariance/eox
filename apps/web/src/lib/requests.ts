import { parseScaled } from "./amounts";

export const UNIT_DIGITS = 12;
const MAX_CLASS_INDEX = 30;
const U64_MAX = (1n << 64n) - 1n;

export type Operation = "deposit" | "switch" | "redeem";

export interface PlanInput {
  operation: Operation;
  fromIndex: number | null;
  toIndex: number | null;
  amount: string;
  minimum: string;
  validForBatches: number;
  targetBatch: number;
  collateralDecimals: number;
}

export type RequestPlan =
  | { operation: "deposit"; to: number; amount: bigint; minimumUnits: bigint; expiryBatch: bigint }
  | { operation: "switch"; from: number; to: number; units: bigint; minimumUnits: bigint; expiryBatch: bigint }
  | { operation: "redeem"; from: number; units: bigint; minimumProceeds: bigint; expiryBatch: bigint };

export type Planned = { plan: RequestPlan; problem: null } | { plan: null; problem: string };

const refuse = (problem: string): Planned => ({ plan: null, problem });

function classIndex(value: number | null): number | null {
  return value !== null && Number.isInteger(value) && value >= 0 && value <= MAX_CLASS_INDEX ? value : null;
}

function minimumOf(text: string, digits: number): bigint | null {
  return text.trim() === "" ? 0n : parseScaled(text, digits);
}

export function planRequest(input: PlanInput): Planned {
  const { operation, collateralDecimals } = input;
  if (!Number.isInteger(input.targetBatch) || input.targetBatch < 0) return refuse("There is no open batch to join.");
  if (!Number.isInteger(input.validForBatches) || input.validForBatches < 1) return refuse("Choose how many batches the request stays valid for.");
  const expiryBatch = BigInt(input.targetBatch + input.validForBatches - 1);
  const from = classIndex(input.fromIndex);
  const to = classIndex(input.toIndex);

  if (operation === "deposit") {
    if (to === null) return refuse("Choose a class to buy into.");
    const amount = parseScaled(input.amount, collateralDecimals);
    if (amount === null) return refuse(`Enter an amount with at most ${collateralDecimals} decimal places.`);
    if (amount <= 0n || amount > U64_MAX) return refuse("Enter an amount above zero.");
    const minimumUnits = minimumOf(input.minimum, UNIT_DIGITS);
    if (minimumUnits === null) return refuse("The minimum units is not a valid number.");
    return { plan: { operation, to, amount, minimumUnits, expiryBatch }, problem: null };
  }

  if (from === null) return refuse("Choose the class to take units from.");
  const units = parseScaled(input.amount, UNIT_DIGITS);
  if (units === null) return refuse(`Enter units with at most ${UNIT_DIGITS} decimal places.`);
  if (units <= 0n) return refuse("Enter an amount above zero.");

  if (operation === "redeem") {
    const minimumProceeds = minimumOf(input.minimum, collateralDecimals);
    if (minimumProceeds === null || minimumProceeds > U64_MAX) return refuse("The minimum proceeds is not a valid amount.");
    return { plan: { operation, from, units, minimumProceeds, expiryBatch }, problem: null };
  }

  if (to === null) return refuse("Choose a class to switch into.");
  if (to === from) return refuse("A switch cannot end in the class it started from.");
  const minimumUnits = minimumOf(input.minimum, UNIT_DIGITS);
  if (minimumUnits === null) return refuse("The minimum units is not a valid number.");
  return { plan: { operation, from, to, units, minimumUnits, expiryBatch }, problem: null };
}
