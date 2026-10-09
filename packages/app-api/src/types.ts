export const APP_API_SCHEMA_VERSION = "eox.app-api/v1";
export const FIXED_POINT_SCALE = "1000000";
export const STALE_AFTER_SECONDS = 10_800;

export type Origin = "fixture" | "live";
export type FixedPoint = string;
export type UnixSeconds = number;

export interface Deployment {
  origin: Origin;
  network: string;
  oracleProgram: string | null;
  registry: string | null;
  fixtureSource: string | null;
}

export interface SnapshotIdentity {
  snapshotId: string;
  sequence: number;
  epoch: string;
  methodology: string;
  baselineId: string;
  predecessor: string | null;
  cutoff: UnixSeconds;
  postcommittedAt: UnixSeconds;
  publishedAt: UnixSeconds;
  evidenceCommitment: string;
  finalization: { transaction: string | null; finalized: true };
}

export interface CountryState {
  state: FixedPoint;
  confidence: FixedPoint;
  saturated: boolean;
  stale: boolean;
}

export interface Reference {
  ratio: FixedPoint;
  change: FixedPoint;
  expressed: FixedPoint;
  confidence: FixedPoint;
}

export interface CountryReference extends CountryState {
  country: string;
  baseline: FixedPoint;
  reference: Reference;
}

export interface ReferenceSnapshot {
  snapshot: SnapshotIdentity;
  multiplier: number;
  world: CountryState;
  countries: CountryReference[];
}

export interface CountryWorldReference {
  snapshot: SnapshotIdentity;
  multiplier: number;
  country: CountryReference;
  world: CountryState;
}

export interface PairReference {
  snapshot: SnapshotIdentity;
  multiplier: number;
  base: string;
  quote: string;
  reference: Reference;
}

export type ProposalState =
  | "draft"
  | "precommitted"
  | "postcommitted"
  | "calculating"
  | "published"
  | "rejected"
  | "cancelled"
  | "expired";

export type AssertionKind = "evidence" | "snapshot";
export type AssertionState = "pending" | "disputed" | "settled-true" | "settled-false";

export interface ProposalAssertion {
  assertionId: string;
  kind: AssertionKind;
  subject: string;
  state: AssertionState;
  challengeStart: UnixSeconds;
  challengeDeadline: UnixSeconds;
}

export interface Proposal {
  proposalId: string;
  epoch: string;
  predecessor: string | null;
  cutoff: UnixSeconds;
  state: ProposalState;
  assertions: ProposalAssertion[];
}

export type ReadinessStatus =
  | "ready"
  | "missing-record"
  | "missing-publication-time"
  | "invalid-publication-time"
  | "excess-precision"
  | "missing-assessment";

export interface SlotReadiness {
  country: string;
  indicator: string;
  status: ReadinessStatus;
  recordId: string | null;
}

export interface EvidenceReadiness {
  evaluatedAt: UnixSeconds;
  slots: SlotReadiness[];
}

export interface PublicationEvent {
  sequence: number;
  snapshot: SnapshotIdentity;
}

export interface PublicationPage {
  events: PublicationEvent[];
  nextAfter: number;
}

export interface Status {
  asOf: UnixSeconds;
  latestSequence: number | null;
  referenceAgeSeconds: number | null;
  staleAfterSeconds: number;
  stale: boolean;
  eligibleForExecution: boolean;
}

export interface ApiResponse<T> {
  schemaVersion: typeof APP_API_SCHEMA_VERSION;
  deployment: Deployment;
  status: Status;
  data: T;
}

export type ErrorCode =
  | "NO_ACCEPTED_REFERENCE"
  | "SNAPSHOT_NOT_FOUND"
  | "INVALID_PAIR"
  | "UNKNOWN_COUNTRY"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  schemaVersion: typeof APP_API_SCHEMA_VERSION;
  error: { code: ErrorCode; message: string };
}
