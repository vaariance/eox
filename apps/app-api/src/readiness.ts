import type { EvidenceReadiness, ReadinessStatus, SlotReadiness } from "@eox/app-api";
import { COUNTRIES, INDICATORS } from "@eox/methodology";
import { readState, writeState } from "./state-file.js";

export interface SlotFact {
  recordId: string;
  country: string;
  indicator: string;
  periodOrdinal: string;
  recordedAt: number;
  value: string;
  rawValue: string | null;
  publishedAt: number | null;
}

interface ReadinessState {
  version: 1;
  cursor: string | null;
  slots: Record<string, SlotFact>;
}

const INITIAL: ReadinessState = { version: 1, cursor: null, slots: {} };
const PAGE_LIMIT = 500;
const RECORD_ID = /^eox:observation:[1-9]\d*$/;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

const slotKey = (country: string, indicator: string) => `${country}/${indicator}`;

function later(candidate: SlotFact, current: SlotFact | undefined): boolean {
  if (!current) return true;
  const a = BigInt(candidate.periodOrdinal);
  const b = BigInt(current.periodOrdinal);
  return a !== b ? a > b : candidate.recordedAt >= current.recordedAt;
}

export function slotStatus(fact: SlotFact | undefined, now: number): ReadinessStatus {
  if (!fact) return "missing-record";
  if (fact.publishedAt === null) return "missing-publication-time";
  if (!Number.isSafeInteger(fact.publishedAt) || fact.publishedAt < 0 || fact.publishedAt > now) return "invalid-publication-time";
  const exact = fact.rawValue ?? fact.value;
  if (!DECIMAL.test(exact) || (exact.split(".")[1]?.replace(/0+$/, "").length ?? 0) > 6) return "excess-precision";
  return "missing-assessment";
}

function parseFact(body: unknown): SlotFact {
  const fact = body as Record<string, unknown>;
  const text = (name: string) => {
    if (typeof fact[name] !== "string") throw new Error(`evidence fact field ${name} is not a string`);
    return fact[name] as string;
  };
  const integer = (name: string) => {
    if (!Number.isSafeInteger(fact[name])) throw new Error(`evidence fact field ${name} is not an integer`);
    return fact[name] as number;
  };
  const periodOrdinal = text("periodOrdinal");
  if (!/^-?\d+$/.test(periodOrdinal)) throw new Error("evidence fact periodOrdinal is not an integer");
  return {
    recordId: text("recordId"),
    country: text("country"),
    indicator: text("indicator"),
    periodOrdinal,
    recordedAt: integer("recordedAt"),
    value: text("value"),
    rawValue: fact.rawValue === null ? null : text("rawValue"),
    publishedAt: fact.publishedAt === null ? null : integer("publishedAt"),
  };
}

export class ReadinessTracker {
  private state: ReadinessState = INITIAL;
  private readonly countries = new Set<string>(COUNTRIES.map(([, iso2]) => iso2));
  private readonly indicators = new Set<string>(INDICATORS);

  constructor(
    private readonly evidenceUrl: string,
    private readonly statePath: string,
    private readonly fetchJson: (url: string) => Promise<unknown> = defaultFetchJson,
  ) {}

  async load(): Promise<void> {
    const state = await readState<ReadinessState>(this.statePath, INITIAL);
    if (state.version !== 1) throw new Error(`unsupported readiness state version ${String(state.version)}`);
    this.state = state;
  }

  async tick(): Promise<number> {
    let applied = 0;
    for (;;) {
      const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (this.state.cursor !== null) query.set("cursor", this.state.cursor);
      const page = (await this.fetchJson(`${this.evidenceUrl}/v1/changes?${query}`)) as {
        cursor?: unknown;
        changes?: unknown;
      };
      if (typeof page.cursor !== "string" || !Array.isArray(page.changes)) throw new Error("malformed evidence change page");
      const slots = { ...this.state.slots };
      for (const change of page.changes as { recordId?: unknown }[]) {
        if (typeof change.recordId !== "string" || !RECORD_ID.test(change.recordId)) throw new Error("malformed evidence change");
        const fact = parseFact(await this.fetchJson(`${this.evidenceUrl}/v1/records/${encodeURIComponent(change.recordId)}`));
        if (!this.countries.has(fact.country) || !this.indicators.has(fact.indicator)) continue;
        const key = slotKey(fact.country, fact.indicator);
        if (later(fact, slots[key])) slots[key] = fact;
        applied += 1;
      }
      const advanced = page.cursor !== this.state.cursor;
      this.state = { version: 1, cursor: page.cursor, slots };
      if (advanced) await writeState(this.statePath, this.state);
      if (!advanced) return applied;
    }
  }

  readiness(now: number): EvidenceReadiness {
    const slots: SlotReadiness[] = [];
    for (const [, country] of COUNTRIES) {
      for (const indicator of INDICATORS) {
        const fact = this.state.slots[slotKey(country, indicator)];
        slots.push({ country, indicator, status: slotStatus(fact, now), recordId: fact?.recordId ?? null });
      }
    }
    return { evaluatedAt: now, slots };
  }
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`evidence API ${response.status} for ${new URL(url).pathname}`);
  return response.json();
}
