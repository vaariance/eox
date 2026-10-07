import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvidenceRecord, PublishedReference, SnapshotInput } from "./types.js";

export interface JournalState {
  version: 1;
  cursor: string | null;
  pending: { changeId: string; record: EvidenceRecord }[];
  seenChanges: string[];
  seenRecords: string[];
  records: Record<string, EvidenceRecord>;
  accepted: EvidenceRecord[];
  active: SnapshotInput | null;
  transactions: Record<string, string[]>;
  quarantine: { proposalId: string; reason: string; changeIds: string[] }[];
  latest: PublishedReference | null;
  publications: PublishedReference[];
  batchOpenedAt: number | null;
  lastRefreshAt: number;
}
export function emptyState(): JournalState {
  return { version: 1, cursor: null, pending: [], seenChanges: [], seenRecords: [], records: {}, accepted: [], active: null, transactions: {}, quarantine: [], latest: null, publications: [], batchOpenedAt: null, lastRefreshAt: 0 };
}
export async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  const file = await open(temp, "w", 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await rename(temp, path);
  const directory = await open(dirname(path), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
/** One process per journal. Atomic rename plus fsync protects cursor and queue together. */
export class Journal {
  constructor(readonly path: string) {}
  async load(): Promise<JournalState> {
    try {
      const state = JSON.parse(await readFile(this.path, "utf8")) as JournalState;
      if (state.version !== 1) throw new Error("UnsupportedJournalVersion");
      return state;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); throw error; }
  }
  async save(state: JournalState): Promise<void> {
    await atomicWrite(this.path, state);
  }
  async lock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    let file;
    try { file = await open(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(lockPath, "utf8"));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error("InvalidJournalLock: inspect lock before removing");
      try { process.kill(pid, 0); } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === "ESRCH") { await unlink(lockPath); return this.lock(); }
        throw probe;
      }
      throw new Error(`JournalAlreadyInUse:${pid}`);
    }
    await file.writeFile(String(process.pid)); await file.close();
    return () => unlink(lockPath);
  }
}
