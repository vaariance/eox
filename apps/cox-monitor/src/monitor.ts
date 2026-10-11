import { type ArchiveVerdict, checkArchivedCutoff, checkArtifacts } from "./archive.js";
import type { ArchivedChange, EvidenceSource } from "./evidence-source.js";
import { type CandleSource, checkAgainstVenues } from "./venue-check.js";

export type VenueStatus = "pending" | "confirmed" | "mismatch" | "unverified" | "not-checked";

export interface Verdict {
  cutoff: number;
  verdict: ArchiveVerdict;
  findings: string[];
  snapshotDigest: string | null;
  checkedAtMs: number;
  venues: VenueStatus;
  venueNotes: string[];
}

export interface VenueSweep {
  confirmed: number;
  mismatches: number;
  unverified: number;
}

export interface MonitorState {
  cursor: string | null;
  verdicts: Verdict[];
  checked: number;
  mismatches: number;
}

export interface MonitorOptions {
  source: EvidenceSource;
  state: MonitorState;
  save(state: MonitorState): Promise<void>;
  pageSize?: number;
  maxPages?: number;
  keep?: number;
  now?: () => number;
  log?(message: string): void;
}

export interface MonitorTick {
  checked: number;
  mismatches: number;
}

export function emptyMonitorState(): MonitorState {
  return { cursor: null, verdicts: [], checked: 0, mismatches: 0 };
}

export class ArchiveMonitor {
  constructor(private readonly options: MonitorOptions) {}

  get state(): MonitorState {
    return this.options.state;
  }

  latest(): Verdict | null {
    return this.state.verdicts[this.state.verdicts.length - 1] ?? null;
  }

  find(cutoff: number): Verdict | null {
    return this.state.verdicts.find((verdict) => verdict.cutoff === cutoff) ?? null;
  }

  recent(limit: number): Verdict[] {
    return this.state.verdicts.slice(-limit).reverse();
  }

  async tick(): Promise<MonitorTick> {
    const { source, save, pageSize = 50, maxPages = 20 } = this.options;
    const result: MonitorTick = { checked: 0, mismatches: 0 };
    for (let page = 0; page < maxPages; page += 1) {
      const changes = await source.changes(this.state.cursor, pageSize);
      for (const change of changes.cutoffs) {
        const verdict = await this.check(change);
        this.record(verdict);
        result.checked += 1;
        if (verdict.verdict === "mismatch") result.mismatches += 1;
      }
      const advanced = changes.after !== this.state.cursor;
      this.state.cursor = changes.after;
      if (changes.cutoffs.length > 0 || advanced) await save(this.state);
      if (changes.cutoffs.length < pageSize) break;
    }
    return result;
  }

  async sweepVenues(candles: CandleSource, options: { maxCutoffs?: number; settleSeconds?: number } = {}): Promise<VenueSweep> {
    const { source, save, now = Date.now, log } = this.options;
    const { maxCutoffs = 60, settleSeconds = 180 } = options;
    const settled = Math.floor(now() / 1000) - settleSeconds;
    const due = this.state.verdicts.filter((verdict) => verdict.verdict === "match" && verdict.venues === "pending" && verdict.cutoff <= settled).slice(0, maxCutoffs);
    const sweep: VenueSweep = { confirmed: 0, mismatches: 0, unverified: 0 };
    if (due.length === 0) return sweep;

    const archived = [];
    for (const verdict of due) {
      const view = await source.cutoff(verdict.cutoff);
      if (view) archived.push(view);
    }
    const checks = await checkAgainstVenues(archived, candles);
    for (const verdict of due) {
      const check = checks.get(verdict.cutoff);
      if (!check) {
        verdict.venues = "unverified";
        verdict.venueNotes = ["the archive no longer serves this cutoff"];
        sweep.unverified += 1;
      } else if (check.findings.length > 0) {
        verdict.venues = "mismatch";
        verdict.verdict = "mismatch";
        verdict.venueNotes = check.findings;
        verdict.findings = [...verdict.findings, ...check.findings.map((finding) => `venue: ${finding}`)];
        this.state.mismatches += 1;
        sweep.mismatches += 1;
        log?.(`VENUE MISMATCH cutoff ${verdict.cutoff}: ${check.findings.join("; ")}`);
      } else if (check.unverified.length > 0) {
        verdict.venues = "unverified";
        verdict.venueNotes = check.unverified;
        sweep.unverified += 1;
      } else {
        verdict.venues = "confirmed";
        sweep.confirmed += 1;
      }
    }
    await save(this.state);
    return sweep;
  }

  private async check(change: ArchivedChange): Promise<Verdict> {
    const { source, now = Date.now } = this.options;
    const archived = await source.cutoff(change.cutoff);
    if (archived === null) {
      return { cutoff: change.cutoff, verdict: "mismatch", findings: ["the change feed lists this cutoff but the archive does not serve it"], snapshotDigest: null, checkedAtMs: now(), venues: "not-checked", venueNotes: [] };
    }
    const check = checkArchivedCutoff(archived);
    const findings = [...check.findings];
    if (archived.snapshot.digest !== change.snapshotDigest || archived.snapshot.admissible !== change.admissible) {
      findings.push("the change feed and the archived cutoff disagree about the snapshot");
    }
    if (check.verdict === "match" || check.verdict === "mismatch") findings.push(...(await checkArtifacts(archived, source)));
    const verdict = findings.length > check.findings.length || check.verdict === "mismatch" ? "mismatch" : check.verdict;
    return { cutoff: change.cutoff, verdict, findings, snapshotDigest: check.snapshotDigest, checkedAtMs: now(), venues: verdict === "match" ? "pending" : "not-checked", venueNotes: [] };
  }

  private record(verdict: Verdict): void {
    const { keep = 1440, log } = this.options;
    const state = this.state;
    const previous = state.verdicts.find((item) => item.cutoff === verdict.cutoff);
    state.verdicts = state.verdicts.filter((item) => item.cutoff !== verdict.cutoff);
    state.verdicts.push(verdict);
    state.verdicts.sort((left, right) => left.cutoff - right.cutoff);
    if (state.verdicts.length > keep) state.verdicts = state.verdicts.slice(-keep);
    if (!previous) state.checked += 1;
    state.mismatches += (verdict.verdict === "mismatch" ? 1 : 0) - (previous?.verdict === "mismatch" ? 1 : 0);
    if (verdict.verdict === "mismatch") log?.(`MISMATCH cutoff ${verdict.cutoff}: ${verdict.findings.join("; ")}`);
  }
}
