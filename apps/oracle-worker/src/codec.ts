import { createHash } from "node:crypto";
import type { EvidenceRecord } from "./types.js";
import { exactValue } from "./provider.js";
import { admitPublicationTime, PUBLICATION_POLICY } from "./publication.js";

export type Integer = number | string;
export interface Rule {
  transform: "Identity" | "Difference" | "FractionalChange";
  normalization: { Directional: { lower: Integer; upper: Integer; direction: number } } | { Target: { target: Integer; distance: Integer } };
  weight: number; unit: number[]; source: number[]; series_id: number[]; source_authority: number;
  comparison_period_delta: Integer; grace_seconds: Integer; zero_seconds: Integer;
}
export interface MathEvidence {
  record_id: number[]; series_id: number[]; artifact_digest: number[]; metadata_digest: number[]; unit: number[]; source: number[];
  value: Integer; published_at: Integer | null; known_at: Integer | null; recorded_at: Integer; period: Integer; quality: number[];
}
export interface Slot { current: MathEvidence; comparison: MathEvidence | null }
export interface Configuration { epochId: string; multiplier: number; countries: { id: string; indicators: { id: string; rule: Rule }[] }[] }
export function integer(value: Integer): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("UnsafeInteger: use decimal strings");
  return BigInt(value);
}
const i64 = (value: Integer) => { const b = Buffer.alloc(8); b.writeBigInt64LE(integer(value)); return b; };
const u16 = (value: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; };
export function hashBytes(value: number[]): Buffer {
  if (value.length !== 32 || value.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw new Error("InvalidHash");
  return Buffer.from(value);
}
export function encodeEvidence(e: MathEvidence): Buffer {
  if (e.quality.length !== 8) throw new Error("InvalidQuality");
  return Buffer.concat([hashBytes(e.record_id), hashBytes(e.series_id), hashBytes(e.artifact_digest), hashBytes(e.metadata_digest), hashBytes(e.unit), hashBytes(e.source),
    i64(e.value), Buffer.from([e.published_at === null ? 0 : 1]), ...(e.published_at === null ? [] : [i64(e.published_at)]),
    Buffer.from([e.known_at === null ? 0 : 1]), ...(e.known_at === null ? [] : [i64(e.known_at)]), i64(e.recorded_at), i64(e.period), ...e.quality.map(u16)]);
}
export function encodeSlot(s: Slot): Buffer { return Buffer.concat([encodeEvidence(s.current), Buffer.from([s.comparison ? 1 : 0]), ...(s.comparison ? [encodeEvidence(s.comparison)] : [])]); }
export function encodeRule(r: Rule): Buffer {
  const transform = ["Identity", "Difference", "FractionalChange"].indexOf(r.transform);
  if (transform < 0) throw new Error("InvalidTransform");
  const n = r.normalization;
  const norm = "Directional" in n ? [Buffer.from([0]), i64(n.Directional.lower), i64(n.Directional.upper), Buffer.from([n.Directional.direction & 255])] : [Buffer.from([1]), i64(n.Target.target), i64(n.Target.distance)];
  return Buffer.concat([hashBytes(r.series_id), Buffer.from([transform]), ...norm, u16(r.weight), hashBytes(r.unit), hashBytes(r.source), u16(r.source_authority), i64(r.comparison_period_delta), i64(r.grace_seconds), i64(r.zero_seconds)]);
}
export function evidenceDigest(e: MathEvidence): Buffer {
  return evidenceDigestFromBytes(encodeEvidence(e));
}
/** Hash stable semantic evidence; full slot bytes still commit recorded provenance. */
export function evidenceDigestFromBytes(encoded: Buffer): Buffer {
  if (encoded.length !== encodedEvidenceLength(encoded)) throw new Error("InvalidEvidenceEncoding");
  const afterPublication = 201 + (encoded[200] === 1 ? 8 : 0);
  const periodOffset = afterPublication + 1 + (encoded[afterPublication] === 1 ? 8 : 0) + 8;
  // Exclude record ID, metadata, nullable known time and ingestion time from stable history identity.
  const semantic = Buffer.concat([encoded.subarray(32, 96), encoded.subarray(128, afterPublication), encoded.subarray(periodOffset)]);
  const domain = Buffer.from("evidence"); const len = Buffer.alloc(4); len.writeUInt32LE(domain.length);
  return createHash("sha256").update(Buffer.concat([Buffer.from("EOX/ORACLE/V1\0"), len, domain, semantic])).digest();
}
export function encodedEvidenceLength(encoded: Buffer): number {
  if (encoded.length < 234 || (encoded[200] !== 0 && encoded[200] !== 1)) throw new Error("InvalidEvidenceEncoding");
  const afterPublication = 201 + (encoded[200] === 1 ? 8 : 0);
  if (encoded[afterPublication] !== 0 && encoded[afterPublication] !== 1) throw new Error("InvalidEvidenceEncoding");
  return afterPublication + 1 + (encoded[afterPublication] === 1 ? 8 : 0) + 8 + 8 + 16;
}
const hashIdentity = (value: string): number[] => [...(/^[a-f0-9]{64}$/.test(value) ? Buffer.from(value, "hex") : createHash("sha256").update(value).digest())];
export function evidenceMetadata(record: EvidenceRecord) {
  const publication = admitPublicationTime(record);
  const converted = publication.basis === "first-observed" || record.source === "imf-portwatch";
  const manifest = converted ? JSON.stringify({ manifest: record.manifest, publication: { policy: PUBLICATION_POLICY, basis: publication.basis, timestamp: publication.timestamp } }) : record.manifest;
  return { country: record.country, indicator: record.indicator, revision_id: record.revisionId, manifest,
    supersedes: record.supersedes, comparison_record_id: record.comparisonRecordId };
}
export function metadataDigest(record: EvidenceRecord): Buffer {
  const string = (value: string) => { const text = Buffer.from(value); const size = Buffer.alloc(4); size.writeUInt32LE(text.length); return Buffer.concat([size, text]); };
  const optional = (value: string | undefined) => value === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), string(value)]);
  const value = evidenceMetadata(record);
  const metadata = Buffer.concat([string(value.country), string(value.indicator), string(value.revision_id), string(value.manifest), optional(value.supersedes), optional(value.comparison_record_id)]);
  const domain = "evidence-metadata";
  return createHash("sha256").update(Buffer.concat([Buffer.from("EOX/ORACLE/V1\0"), string(domain), metadata])).digest();
}
export function adaptEvidence(record: EvidenceRecord): MathEvidence {
  const value = exactValue(record.value);
  return { record_id: hashIdentity(record.recordId), series_id: hashIdentity(record.seriesId), artifact_digest: hashIdentity(record.artifactDigest), metadata_digest: [...metadataDigest(record)], unit: hashIdentity(record.unit), source: hashIdentity(record.source), value: value.toString(), published_at: admitPublicationTime(record).timestamp, known_at: record.knownAt, recorded_at: record.recordedAt, period: record.period, quality: record.confidenceBps };
}
export function buildSlots(config: Configuration, records: EvidenceRecord[]): Slot[][] {
  return config.countries.map(country => country.indicators.map(indicator => {
    const candidates = records.filter(r => r.country === country.id && r.indicator === indicator.id);
    const comparisons = new Set(records.flatMap(r => r.comparisonRecordId ? [r.comparisonRecordId] : []));
    const current = candidates.filter(r => !comparisons.has(r.recordId));
    if (current.length !== 1) throw new Error(`IncompleteOrDuplicateSlot:${country.id}/${indicator.id}`);
    const record = current[0]!;
    const comparison = record.comparisonRecordId ? records.find(r => r.recordId === record.comparisonRecordId) : null;
    if (record.comparisonRecordId && !comparison) throw new Error("MissingComparison");
    return { current: adaptEvidence(record), comparison: comparison ? adaptEvidence(comparison) : null };
  }));
}
