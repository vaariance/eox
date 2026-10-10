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

const USD_E8 = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/;
const U64_MAX = (1n << 64n) - 1n;

export function exactE8(text: string): bigint | null {
  const match = USD_E8.exec(text);
  if (!match) return null;
  const value = BigInt(match[1]!) * E8 + BigInt((match[2] ?? "").padEnd(8, "0"));
  return value > U64_MAX ? null : value;
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
