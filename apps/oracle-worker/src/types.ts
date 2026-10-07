/** Oracle-owned boundary; ingestion and its database are deliberately not dependencies. */
export interface EvidenceRecord {
  recordId: string;
  seriesId: string;
  revisionId: string;
  country: string;
  indicator: string;
  source: string;
  unit: string;
  period: string;
  value: string;
  publishedAt: number | null;
  knownAt: number | null;
  recordedAt: number;
  artifactDigest: string;
  manifest: string;
  confidenceBps: [number, number, number, number, number, number, number, number];
  supersedes?: string;
  comparisonRecordId?: string;
}

export interface EvidenceChange { changeId: string; recordId: string }
export interface ChangePage { cursor: string; changes: EvidenceChange[] }
export interface EvidenceProvider {
  readChanges(cursor: string | null): Promise<ChangePage>;
  loadEvidence(recordId: string): Promise<EvidenceRecord>;
  retrieveArtifact(digest: string): Promise<Uint8Array>;
}

export interface SnapshotInput {
  proposalId: string;
  predecessor: string | null;
  cutoff: number;
  records: EvidenceRecord[];
  changeIds: string[];
}
export type ProposalStatus = "draft" | "precommitted" | "postcommitted" | "calculating" | "published" | "rejected" | "cancelled" | "expired";
export interface PublishedReference {
  proposalId: string;
  sequence: number;
  epoch: string;
  methodology: string;
  cutoff: number;
  postcommittedAt: number;
  signature: string;
  /** Real RPC implementations must return only finalized publications. */
  finalized: true;
  snapshotAddress: string;
}
export interface ProposalProgress {
  status: ProposalStatus;
  transactionSignatures: string[];
  publication?: PublishedReference;
}
export interface OracleTransport {
  /** Must be idempotent by proposalId, including when the response is lost. */
  advance(input: SnapshotInput): Promise<ProposalProgress>;
}

/** Integer strings at scale 1,000,000; retain snapshot identity with consumption. */
export interface IndexReference {
  snapshot: string;
  epoch: string;
  base: string;
  quote: string;
  ratio: string;
  change: string;
  expressed: string;
  confidence: string;
}
