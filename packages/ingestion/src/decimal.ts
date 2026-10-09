const DECIMAL_PATTERN = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

function parse(value: string): { units: bigint; scale: number } {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) throw new Error(`invalid decimal: ${value}`);
  const [, sign, whole, fraction = ""] = match;
  const units = BigInt(`${whole}${fraction}`);
  return { units: sign ? -units : units, scale: fraction.length };
}

export function sumDecimals(values: readonly string[]): string {
  const parsed = values.map(parse);
  const scale = Math.max(0, ...parsed.map((p) => p.scale));
  const total = parsed.reduce((sum, p) => sum + p.units * 10n ** BigInt(scale - p.scale), 0n);
  if (scale === 0) return total.toString();
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  return `${negative ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
