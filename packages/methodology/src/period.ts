import type { Frequency } from "./catalogue.js";

export function periodOrdinal(frequency: Frequency, period: string): string {
  const pattern = frequency === "daily" ? /^(\d{4})-(\d{2})-(\d{2})$/ : frequency === "monthly" ? /^(\d{4})-(\d{2})$/ : frequency === "quarterly" ? /^(\d{4})-Q([1-4])$/ : null;
  const match = pattern?.exec(period);
  if (!match) throw new Error("InvalidPeriod");
  const year = Number(match[1]);
  const part = Number(match[2]);
  if (year < 1) throw new Error("InvalidPeriod");
  if (frequency === "quarterly") return String(year * 4 + part - 1);
  if (part < 1 || part > 12) throw new Error("InvalidPeriod");
  if (frequency === "monthly") return String(year * 12 + part - 1);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[part - 1]!) throw new Error("InvalidPeriod");
  const date = new Date(0);
  date.setUTCFullYear(year, part - 1, day);
  return String(date.getTime() / 86_400_000);
}
