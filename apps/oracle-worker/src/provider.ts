import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ChangePage, EvidenceProvider, EvidenceRecord } from "./types.js";
import { admitPublicationTime } from "./publication.js";

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function exactValue(value: string): bigint {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error("InvalidDecimal");
  const significantFraction = value.split(".")[1]?.replace(/0+$/, "") ?? "";
  if (significantFraction.length > 6) throw new Error("ExcessPrecision");
  const [whole = "0", fraction = ""] = value.replace(/^-/, "").split(".");
  const magnitude = BigInt(whole) * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, "0"));
  if (magnitude > 10n ** 18n) throw new Error("ValueOutOfRange");
  return value.startsWith("-") ? -magnitude : magnitude;
}

export function assertReady(record: EvidenceRecord, now: number): void {
  admitPublicationTime(record, now);
  exactValue(record.value);
  if (!Array.isArray(record.confidenceBps) || record.confidenceBps.length !== 8 || record.confidenceBps.some(x => !Number.isInteger(x) || x < 0 || x > 10_000)) throw new Error(`InvalidConfidence:${record.recordId}`);
  if (!/^[a-f0-9]{64}$/.test(record.artifactDigest)) throw new Error(`InvalidArtifactDigest:${record.recordId}`);
  for (const field of [record.recordId, record.seriesId, record.revisionId, record.country, record.indicator, record.source, record.unit, record.period, record.manifest]) {
    if (typeof field !== "string" || field.length === 0) throw new Error(`MissingEvidenceIdentity:${record.recordId}`);
  }
}

export interface FixtureFile {
  records: EvidenceRecord[];
  changes: { changeId: string; recordId: string }[];
  artifacts: Record<string, string>;
}

/** Reloads the fixture on every poll, allowing an append-only stream during a demo. */
export class FixtureProvider implements EvidenceProvider {
  constructor(private readonly file: string, private readonly pageSize = 128) {}
  private async read(): Promise<FixtureFile> { return JSON.parse(await readFile(this.file, "utf8")) as FixtureFile; }
  async readChanges(cursor: string | null): Promise<ChangePage> {
    const data = await this.read();
    // Cursors include the consumed prefix digest: rewriting history cannot silently skip data.
    const [countText, digest] = cursor?.split(":") ?? ["0", sha256("[]")];
    const count = Number(countText);
    if (!Number.isSafeInteger(count) || count < 0 || count > data.changes.length || sha256(JSON.stringify(data.changes.slice(0, count))) !== digest) throw new Error("FixtureCursorHistoryChanged");
    const end = Math.min(count + this.pageSize, data.changes.length);
    return { changes: data.changes.slice(count, end), cursor: `${end}:${sha256(JSON.stringify(data.changes.slice(0, end)))}` };
  }
  async loadEvidence(recordId: string): Promise<EvidenceRecord> {
    const matches = (await this.read()).records.filter(r => r.recordId === recordId);
    if (matches.length !== 1) throw new Error(`MissingOrDuplicateEvidence:${recordId}`);
    return matches[0]!;
  }
  async retrieveArtifact(digest: string): Promise<Uint8Array> {
    const artifact = (await this.read()).artifacts[digest];
    if (artifact === undefined) throw new Error(`MissingArtifact:${digest}`);
    const bytes = Buffer.from(artifact, "base64");
    if (sha256(bytes) !== digest) throw new Error(`ArtifactHashMismatch:${digest}`);
    return bytes;
  }
}
