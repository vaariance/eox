import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { PendingTransaction, PublisherIdentity, PublisherState, StateStore } from "./types.js";

export function emptyState(identity: PublisherIdentity): PublisherState {
  return { version: 1, identity: { ...identity }, pending: null, lastOutcome: null, lastCutoff: null };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validate(value: unknown, identity: PublisherIdentity): PublisherState {
  if (!record(value) || value.version !== 1 || !record(value.identity)) throw new Error("InvalidPublisherJournal");
  if (value.identity.program !== identity.program || value.identity.pool !== identity.pool
    || value.identity.genesisHash !== identity.genesisHash) throw new Error("PublisherJournalIdentityMismatch");
  if (value.lastOutcome !== null && typeof value.lastOutcome !== "string") throw new Error("InvalidPublisherJournal");
  if (value.lastCutoff !== null && (typeof value.lastCutoff !== "string" || !/^\d+$/.test(value.lastCutoff))) throw new Error("InvalidPublisherJournal");
  if (value.pending !== null) {
    const p = value.pending;
    const kinds = ["publish", "evaluate", "safety", "sealEvaluation", "execute", "finalize"];
    if (!record(p) || !kinds.includes(p.kind as string)
      || ["operationId", "requestId", "revision", "unsignedBase64", "blockhash", "keyVersion"].some(key => typeof p[key] !== "string" || !p[key])
      || ["batchId", "sequence"].some(key => typeof p[key] !== "string" || !/^\d+$/.test(p[key] as string))
      || (p.signedBase64 !== null && (typeof p.signedBase64 !== "string" || !p.signedBase64))
      || (p.signature !== null && (typeof p.signature !== "string" || !p.signature))
      || ((p.signedBase64 === null) !== (p.signature === null))
      || !Number.isSafeInteger(p.lastValidBlockHeight) || (p.lastValidBlockHeight as number) < 0
      || !Number.isSafeInteger(p.expiresAt) || (p.expiresAt as number) < 0) throw new Error("InvalidPublisherJournal");
  }
  return { version: 1, identity: { ...identity }, pending: value.pending as PendingTransaction | null,
    lastOutcome: value.lastOutcome as string | null, lastCutoff: value.lastCutoff as string | null };
}

export async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export class Journal implements StateStore {
  constructor(readonly path: string, readonly identity: PublisherIdentity) {}

  async load(): Promise<PublisherState> {
    let text: string;
    try { text = await readFile(this.path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(this.identity);
      throw error;
    }
    return validate(JSON.parse(text), this.identity);
  }

  async save(state: PublisherState): Promise<void> {
    await atomicWrite(this.path, validate(state, this.identity));
  }

  async lock(): Promise<() => Promise<void>> {
    await mkdir(dirname(this.path), { recursive: true });
    const lockPath = `${this.path}.lock`;
    const token = randomUUID();
    let file;
    try { file = await open(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const lock: unknown = JSON.parse(await readFile(lockPath, "utf8"));
      if (!record(lock) || !Number.isSafeInteger(lock.pid) || (lock.pid as number) <= 0) throw new Error("InvalidPublisherLock");
      try { process.kill(lock.pid as number, 0); }
      catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === "ESRCH") throw new Error(`StalePublisherLock:${lock.pid}:remove only while publisher is stopped`);
        throw probe;
      }
      throw new Error(`PublisherAlreadyInUse:${lock.pid}`);
    }
    try { await file.writeFile(JSON.stringify({ pid: process.pid, token })); await file.sync(); }
    finally { await file.close(); }
    let released = false;
    return async () => {
      if (released) return;
      const lock: unknown = JSON.parse(await readFile(lockPath, "utf8"));
      if (!record(lock) || lock.token !== token) throw new Error("PublisherLockOwnershipLost");
      await unlink(lockPath);
      released = true;
    };
  }
}
