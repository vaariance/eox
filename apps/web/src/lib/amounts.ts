const DECIMAL = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;

export function parseScaled(text: string, digits: number): bigint | null {
  const match = DECIMAL.exec(text.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > digits) return null;
  return BigInt(match[1]! + fraction.padEnd(digits, "0"));
}
