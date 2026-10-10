export const SCALE = 1_000_000_000_000n;
export const REFERENCE_BASE = 100n * SCALE;

const I128_MAX = (1n << 127n) - 1n;
const I128_MIN = -(1n << 127n);

export class MonitorMathError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MonitorMathError";
  }
}

export function fail(code: string): never {
  throw new MonitorMathError(code);
}

export function i128(value: bigint): bigint {
  if (value > I128_MAX || value < I128_MIN) fail("ArithmeticOverflow");
  return value;
}

export function times(left: bigint, right: bigint): bigint {
  return i128(left * right);
}

export function plus(left: bigint, right: bigint): bigint {
  return i128(left + right);
}

export function sum(values: readonly bigint[]): bigint {
  return values.reduce(plus, 0n);
}

export function divideNearest(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) fail("InvalidDenominator");
  const magnitude = numerator < 0n ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const rounded = magnitude % denominator * 2n >= denominator ? quotient + 1n : quotient;
  return numerator < 0n ? -rounded : rounded;
}

export function divideDown(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) fail("InvalidDivision");
  return numerator / denominator;
}
