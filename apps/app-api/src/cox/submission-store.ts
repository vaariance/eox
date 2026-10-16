import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Submission } from "@eox/app-api";

const SCHEMA = "cox.app-api.submissions/v1";
const MAX_KEPT = 5000;
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const COLLECTION = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const DATABASE = /^(\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;

export interface StoredSubmission extends Submission {
  recentBlockhash: string;
}

export interface SubmissionStore {
  get(signature: string): Promise<StoredSubmission | null>;
  create(entry: StoredSubmission): Promise<"created" | "exists">;
  update(entry: StoredSubmission): Promise<void>;
}

export class FileSubmissionStore implements SubmissionStore {
  private readonly entries = new Map<string, StoredSubmission>();

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      const stored = JSON.parse(readFileSync(path, "utf8")) as { schema: string; submissions: StoredSubmission[] };
      if (stored.schema !== SCHEMA) throw new Error(`unsupported submissions file ${path}`);
      for (const entry of stored.submissions) this.entries.set(entry.signature, entry);
    }
  }

  async get(signature: string): Promise<StoredSubmission | null> {
    const entry = this.entries.get(signature);
    return entry ? { ...entry } : null;
  }

  async create(entry: StoredSubmission): Promise<"created" | "exists"> {
    if (this.entries.has(entry.signature)) return "exists";
    this.entries.set(entry.signature, { ...entry });
    this.save();
    return "created";
  }

  async update(entry: StoredSubmission): Promise<void> {
    this.entries.set(entry.signature, { ...entry });
    this.save();
  }

  private save(): void {
    const all = [...this.entries.values()].sort((a, b) => a.submittedAt - b.submittedAt);
    for (const entry of all.slice(0, Math.max(0, all.length - MAX_KEPT))) this.entries.delete(entry.signature);
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify({ schema: SCHEMA, submissions: [...this.entries.values()] }));
    renameSync(temporary, this.path);
  }
}

export class FirestoreSubmissionStore implements SubmissionStore {
  private readonly base: string;

  constructor(
    project: string,
    collection: string,
    private readonly token: () => Promise<string>,
    private readonly request: typeof fetch = fetch,
    database = "(default)",
  ) {
    if (!PROJECT.test(project)) throw new Error(`invalid Firestore project id: ${project}`);
    if (!COLLECTION.test(collection)) throw new Error(`invalid Firestore collection: ${collection}`);
    if (!DATABASE.test(database)) throw new Error(`invalid Firestore database: ${database}`);
    this.base = `https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents/${collection}`;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    return this.request(url, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${await this.token()}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  }

  private fields(entry: StoredSubmission) {
    return {
      entry: { stringValue: JSON.stringify(entry) },
      owner: { stringValue: entry.owner },
      state: { stringValue: entry.state },
      expireAt: { timestampValue: new Date(entry.submittedAt * 1000 + RETAIN_MS).toISOString() },
    };
  }

  async get(signature: string): Promise<StoredSubmission | null> {
    if (!SIGNATURE.test(signature)) return null;
    const response = await this.call(`${this.base}/${signature}`, { method: "GET" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Firestore read failed: ${response.status}`);
    const body = (await response.json()) as { fields?: { entry?: { stringValue?: string } } };
    const text = body.fields?.entry?.stringValue;
    if (text === undefined) throw new Error(`stored submission ${signature} has no entry`);
    const entry = JSON.parse(text) as StoredSubmission;
    if (entry.signature !== signature) throw new Error(`stored submission ${signature} does not match its key`);
    return entry;
  }

  async create(entry: StoredSubmission): Promise<"created" | "exists"> {
    if (!SIGNATURE.test(entry.signature)) throw new Error("invalid submission signature");
    const response = await this.call(`${this.base}?documentId=${entry.signature}`, { method: "POST", body: JSON.stringify({ fields: this.fields(entry) }) });
    if (response.status === 409) return "exists";
    if (!response.ok) throw new Error(`Firestore write failed: ${response.status}`);
    return "created";
  }

  async update(entry: StoredSubmission): Promise<void> {
    if (!SIGNATURE.test(entry.signature)) throw new Error("invalid submission signature");
    const mask = ["entry", "owner", "state", "expireAt"].map((field) => `updateMask.fieldPaths=${field}`).join("&");
    const response = await this.call(`${this.base}/${entry.signature}?${mask}&currentDocument.exists=true`, { method: "PATCH", body: JSON.stringify({ fields: this.fields(entry) }) });
    if (!response.ok) throw new Error(`Firestore write failed: ${response.status}`);
  }
}
