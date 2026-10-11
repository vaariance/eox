import { divideNearest, fail, times } from "./arithmetic.js";

const PRICE_SCALE = 100_000_000n;
const U64_MAX = (1n << 64n) - 1n;
const EXACT_USD = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/;
const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function price(value: bigint): bigint {
  if (value <= 0n || value > U64_MAX) fail("InvalidPrice");
  return value;
}

export function usdToE8(close: string): bigint {
  const match = EXACT_USD.exec(close);
  if (!match) fail("InvalidUsdPrecision");
  const fraction = match[2] ?? "";
  return price(BigInt(match[1]!) * PRICE_SCALE + BigInt(fraction.padEnd(8, "0")));
}

function fractionOf(value: string): { numerator: bigint; denominator: bigint } {
  const match = DECIMAL.exec(value);
  if (!match) fail("InvalidDecimal");
  const fraction = match[2] ?? "";
  return { numerator: BigInt(match[1]! + fraction), denominator: 10n ** BigInt(fraction.length) };
}

export function usdtToE8(closeUsdt: string, usdtUsd: string): bigint {
  const close = fractionOf(closeUsdt);
  const rate = fractionOf(usdtUsd);
  return price(divideNearest(times(times(close.numerator, rate.numerator), PRICE_SCALE), times(close.denominator, rate.denominator)));
}

export function sameDecimal(left: string, right: string): boolean {
  const a = fractionOf(left);
  const b = fractionOf(right);
  return a.numerator * b.denominator === b.numerator * a.denominator;
}
