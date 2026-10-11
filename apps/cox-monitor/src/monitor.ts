import { type ArchiveVerdict, checkArchivedCutoff, checkArtifacts } from "./archive.js";
import type { ArchivedChange, EvidenceSource } from "./evidence-source.js";

export interface Verdict {
  cutoff: number;
  verdict: ArchiveVerdict;
  findings: string[];
  snapshotDigest: string | null;
  checkedAtMs: number;
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

  private async check(change: ArchivedChange): Promise<Verdict> {
    const { source, now = Date.now } = this.options;
    const archived = await source.cutoff(change.cutoff);
    if (archived === null) {
      return { cutoff: change.cutoff, verdict: "mismatch", findings: ["the change feed lists this cutoff but the archive does not serve it"], snapshotDigest: null, checkedAtMs: now() };
    }
    const check = checkArchivedCutoff(archived);
    const findings = [...check.findings];
    if (archived.snapshot.digest !== change.snapshotDigest || archived.snapshot.admissible !== change.admissible) {
      findings.push("the change feed and the archived cutoff disagree about the snapshot");
    }
    if (check.verdict === "match" || check.verdict === "mismatch") findings.push(...(await checkArtifacts(archived, source)));
    const verdict = findings.length > check.findings.length || check.verdict === "mismatch" ? "mismatch" : check.verdict;
    return { cutoff: change.cutoff, verdict, findings, snapshotDigest: check.snapshotDigest, checkedAtMs: now() };
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
