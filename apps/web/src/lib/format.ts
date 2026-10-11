const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatAmount(value: number, digits = 2): string {
  if (digits === 2) return usd.format(value);
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function formatWhole(value: number): string {
  return whole.format(value);
}

export function formatChange(ratio: number): string {
  const percent = ratio * 100;
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `${sign}${Math.abs(percent).toFixed(2)}%`;
}

export function formatUtcTime(unixSeconds: number): string {
  return `${new Date(unixSeconds * 1000).toISOString().slice(11, 19)} UTC`;
}

export function direction(ratio: number): "up" | "down" | "flat" {
  if (ratio > 0.000005) return "up";
  if (ratio < -0.000005) return "down";
  return "flat";
}

export function formatPrice(value: number): string {
  if (value >= 1) return formatAmount(value, 2);
  if (value >= 0.01) return formatAmount(value, 4);
  return formatAmount(value, 6);
}
