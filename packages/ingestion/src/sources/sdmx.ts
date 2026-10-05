import { setTimeout as sleep } from "node:timers/promises";

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const QUARTER_PATTERN = /^(\d{4})-Q([1-4])$/;
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;
const STORED_SCALE = 6;
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 120_000;

export type SdmxRow = Record<string, string>;

export interface PeriodBounds {
  periodStart: string;
  periodEnd: string;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("SDMX CSV ended inside a quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (retryAfter !== null && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(BASE_RETRY_DELAY_MS * 3 ** attempt, MAX_RETRY_DELAY_MS);
}

async function fetchWithRetry(url: string, label: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "text/csv" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (isLastAttempt) throw new Error(`${label} request failed after ${MAX_ATTEMPTS} attempts`, { cause: error });
      await sleep(retryDelayMs(attempt, null));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && !isLastAttempt) {
      await res.body?.cancel();
      await sleep(retryDelayMs(attempt, res.headers.get("retry-after")));
      continue;
    }
    return res;
  }
}

export async function fetchSdmxCsv(url: string, label: string): Promise<SdmxRow[]> {
  const res = await fetchWithRetry(url, label);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`${label} request failed: ${res.status} ${res.statusText}`);
  const [header, ...records] = parseCsv(await res.text());
  if (!header || !header.includes("TIME_PERIOD") || !header.includes("OBS_VALUE")) {
    throw new Error(`${label} returned an unexpected payload`);
  }
  return records
    .filter((record) => record.length === header.length)
    .map((record) => Object.fromEntries(header.map((column, index) => [column, record[index]])));
}

function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function periodBounds(timePeriod: string): PeriodBounds {
  const monthly = MONTH_PATTERN.exec(timePeriod);
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]);
    if (month < 1 || month > 12) throw new Error(`invalid SDMX period: ${timePeriod}`);
    return { periodStart: `${monthly[1]}-${monthly[2]}-01`, periodEnd: lastDayOfMonth(year, month) };
  }
  const quarterly = QUARTER_PATTERN.exec(timePeriod);
  if (quarterly) {
    const year = Number(quarterly[1]);
    const firstMonth = (Number(quarterly[2]) - 1) * 3 + 1;
    return {
      periodStart: `${year}-${String(firstMonth).padStart(2, "0")}-01`,
      periodEnd: lastDayOfMonth(year, firstMonth + 2),
    };
  }
  throw new Error(`unsupported SDMX period: ${timePeriod}`);
}

export function toStoredDecimal(raw: string, shiftLeft = 0): string {
  const match = DECIMAL_PATTERN.exec(raw.trim());
  if (!match) throw new Error(`invalid SDMX value: ${raw}`);
  const [, sign, integerPart, fractionPart = ""] = match;
  const digits = (integerPart + fractionPart).replace(/^0+(?=\d)/, "");
  const scale = fractionPart.length + shiftLeft;
  const padded = digits.padStart(scale + 1, "0");
  const wholeDigits = padded.slice(0, padded.length - scale);
  const fractionDigits = padded.slice(padded.length - scale);

  let units = BigInt(wholeDigits + fractionDigits.slice(0, STORED_SCALE).padEnd(STORED_SCALE, "0"));
  if (fractionDigits.length > STORED_SCALE && Number(fractionDigits[STORED_SCALE]) >= 5) units += 1n;

  const magnitude = units.toString().padStart(STORED_SCALE + 1, "0");
  const whole = magnitude.slice(0, -STORED_SCALE);
  const fraction = magnitude.slice(-STORED_SCALE);
  return `${units === 0n ? "" : sign}${whole}.${fraction}`;
}
