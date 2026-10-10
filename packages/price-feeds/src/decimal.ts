const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
const E8 = 100_000_000n;

export function isDecimal(text: string): boolean {
  return DECIMAL.test(text);
}

function parts(text: string): { negative: boolean; digits: bigint; scale: number } {
  const match = DECIMAL.exec(text);
  if (!match) throw new Error(`not a decimal: ${text}`);
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  return { negative: match[1] === "-", digits: BigInt(`${match[2]}${fraction}`), scale: fraction.length };
}

export function exactE8(text: string): bigint | null {
  const { negative, digits, scale } = parts(text);
  if (scale > 8) return null;
  const value = digits * 10n ** BigInt(8 - scale);
  return negative ? -value : value;
}

export function convertedE8(close: string, usdtUsd: string): bigint {
  const a = parts(close);
  const b = parts(usdtUsd);
  const numerator = a.digits * b.digits * E8;
  const denominator = 10n ** BigInt(a.scale + b.scale);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return a.negative !== b.negative ? -rounded : rounded;
}

export function isPositiveDecimal(text: string): boolean {
  const { negative, digits } = parts(text);
  return !negative && digits > 0n;
}
