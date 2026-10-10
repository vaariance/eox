export const PUBLICATION_POLICY = "EOX/PUBLICATION/V2";

export interface PublicationInput {
  recordId: string;
  source: string;
  publishedAt: number | null;
  recordedAt: number;
  publication?: { release: { releasedAtMs: number } } | null;
}

export interface AdmittedPublication {
  policy: typeof PUBLICATION_POLICY;
  basis: "source" | "first-observed";
  timestamp: number;
}

export function admitPublicationTime(record: PublicationInput, cutoff?: number): AdmittedPublication {
  if (!Number.isSafeInteger(record.recordedAt) || record.recordedAt < 0
    || (cutoff !== undefined && (!Number.isSafeInteger(cutoff) || record.recordedAt > cutoff))) {
    throw new Error(`InvalidRecordedTime:${record.recordId}`);
  }
  let timestamp = record.publishedAt;
  let basis: AdmittedPublication["basis"] = "source";
  if (record.source === "imf-portwatch") {
    const milliseconds = record.publication?.release.releasedAtMs;
    if (milliseconds !== undefined) {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error(`InvalidPublicationTime:${record.recordId}`);
      timestamp = Math.floor(milliseconds / 1000);
    } else if (timestamp !== null) {
      if (!Number.isFinite(timestamp) || timestamp < 0) throw new Error(`InvalidPublicationTime:${record.recordId}`);
      timestamp = Math.floor(timestamp);
    }
  }
  if (timestamp === null && (record.source === "oecd" || record.source === "bis")) {
    timestamp = record.recordedAt;
    basis = "first-observed";
  }
  if (timestamp === null) throw new Error(`MissingPublicationTime:${record.recordId}`);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || (cutoff !== undefined && timestamp > cutoff)) {
    throw new Error(`InvalidPublicationTime:${record.recordId}`);
  }
  return { policy: PUBLICATION_POLICY, basis, timestamp };
}
