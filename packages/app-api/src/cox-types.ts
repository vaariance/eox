import type { UnixSeconds } from "./types.js";

export const COX_APP_API_SCHEMA_VERSION = "cox.app-api/v1";
export const COX_PRICE_SCALE = "100000000";
export const COX_REFERENCE_SCALE = "1000000000000";
export const COX_UNIT_SCALE = "1000000000000";
export const COX_TRANSFER_RULE = "COX/TRANSFER/MVP-0";
export const BATCH_SECONDS = 60;
export const COMMIT_DEADLINE_SECONDS = 55;
export const MAX_TRADE_AGE_MINUTES = 30;
export const DELAYED_AFTER_MISSED_CUTOFFS = 3;
export const HALTED_AFTER_MISSED_CUTOFFS = 60;

export type CoxOrigin = "fixture" | "live";
export type Scaled = string;
export type BaseUnits = string;
export type ClassId = string;

export interface CoxDeployment {
  origin: CoxOrigin;
  network: string;
  program: string | null;
  pool: string | null;
  collateralMint: string | null;
  collateralDecimals: number;
  testCollateral: true;
  transferRule: typeof COX_TRANSFER_RULE;
  methodologyDigest: string | null;
  fixtureSource: string | null;
}

export type PriceVenue = "kraken" | "coinbase" | "bybit";
export type FallbackStep = 1 | 2 | 3 | 4;

export interface CoxAsset {
  assetId: string;
  position: number;
  name: string;
  krakenWsSymbol: string;
  krakenRestPair: string;
  coinbaseProduct: string | null;
  bybitSymbol: string | null;
  lastVenue: PriceVenue | null;
  tradeAgeMinutes: number | null;
}

export interface CryptoMember {
  assetId: string;
  weight: Scaled;
}

export interface CryptoComposition {
  label: string;
  methodologyDigest: string;
  members: CryptoMember[];
}

export interface PublicationIdentity {
  program: string;
  pool: string;
  sequence: number;
  predecessorSequence: number | null;
  cutoff: UnixSeconds;
  methodologyDigest: string;
  snapshotDigest: string;
  finalization: { transaction: string | null; slot: number | null; finalized: true };
}

export interface PublishedPrice {
  assetId: string;
  priceE8: Scaled;
  venue: PriceVenue;
  step: FallbackStep;
  tradeAgeMinutes: number;
}

export interface AssetReference {
  assetId: string;
  reference: Scaled;
}

export interface ClassState {
  backing: BaseUnits;
  units: Scaled;
}

export interface ClassValuation {
  classId: ClassId;
  preFlow: ClassState;
  postFlow: ClassState;
  unitValue: Scaled | null;
}

export interface LedgerTotals {
  activeBacking: BaseUnits;
  pendingDeposits: BaseUnits;
  withdrawalPayables: BaseUnits;
  residual: BaseUnits;
  vault: BaseUnits;
}

export interface Publication {
  identity: PublicationIdentity;
  prices: PublishedPrice[];
  cryptoLevel: Scaled;
  references: AssetReference[];
  classes: ClassValuation[];
  executedRequests: number;
  rejectedRequests: number;
  ledger: LedgerTotals;
}

export type BatchState = "open" | "closed";

export interface Batch {
  cutoff: UnixSeconds;
  commitDeadline: UnixSeconds;
  state: BatchState;
}

export type SystemState = "fresh" | "delayed" | "halted" | "incident" | "paused";
export type MonitorVerdict = "match" | "mismatch" | "pending";

export interface CoxStatus {
  asOf: UnixSeconds;
  latestSequence: number | null;
  latestCutoff: UnixSeconds | null;
  ageSeconds: number | null;
  missedCutoffs: number;
  state: SystemState;
  monitor: { sequence: number; verdict: MonitorVerdict } | null;
  currentBatch: Batch;
}

export type RequestOperation = "deposit" | "switch" | "redeem";
export type RequestState = "queued" | "executed" | "rejected" | "cancelled" | "expired";

export interface CoxRequest {
  requestId: string;
  owner: string;
  operation: RequestOperation;
  fromClass: ClassId | null;
  toClass: ClassId | null;
  amount: BaseUnits | null;
  units: Scaled | null;
  minimumOut: string;
  batchCutoff: UnixSeconds;
  expiryCutoff: UnixSeconds;
  state: RequestState;
  executedSequence: number | null;
  rejection: string | null;
}

export interface Receipt {
  requestId: string;
  sequence: number;
  operation: RequestOperation;
  unitValue: Scaled;
  unitsIn: Scaled | null;
  unitsOut: Scaled | null;
  collateralIn: BaseUnits | null;
  collateralOut: BaseUnits | null;
}

export interface Position {
  classId: ClassId;
  units: Scaled;
  lockedUnits: Scaled;
  redeemableValue: BaseUnits;
  depositedBasis: BaseUnits;
}

export interface Portfolio {
  owner: string;
  positions: Position[];
  pending: CoxRequest[];
  receipts: Receipt[];
  withdrawalPayable: BaseUnits;
  valuedAtSequence: number | null;
}

export interface CoxPublicationEvent {
  sequence: number;
  publication: Publication;
}

export interface CoxPublicationPage {
  events: CoxPublicationEvent[];
  nextAfter: number | null;
}

export interface CoxApiResponse<T> {
  schemaVersion: typeof COX_APP_API_SCHEMA_VERSION;
  deployment: CoxDeployment;
  status: CoxStatus;
  data: T;
}

export type CoxErrorCode =
  | "NO_PUBLICATION"
  | "PUBLICATION_NOT_FOUND"
  | "UNKNOWN_ASSET"
  | "UNKNOWN_CLASS"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "INTERNAL_ERROR";

export interface CoxApiErrorBody {
  schemaVersion: typeof COX_APP_API_SCHEMA_VERSION;
  error: { code: CoxErrorCode; message: string };
}

export function batchFor(now: UnixSeconds, origin: UnixSeconds): Batch {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(origin) || origin % BATCH_SECONDS !== 0) {
    throw new Error("batch times must be whole seconds with a minute-aligned origin");
  }
  const elapsed = now < origin ? 0 : Math.floor((now - origin) / BATCH_SECONDS) + 1;
  const cutoff = origin + elapsed * BATCH_SECONDS;
  return { cutoff, commitDeadline: cutoff + COMMIT_DEADLINE_SECONDS, state: "open" };
}

export function systemState(missedCutoffs: number, paused: boolean, incident: boolean): SystemState {
  if (paused) return "paused";
  if (missedCutoffs >= HALTED_AFTER_MISSED_CUTOFFS) return "halted";
  if (incident) return "incident";
  if (missedCutoffs >= DELAYED_AFTER_MISSED_CUTOFFS) return "delayed";
  return "fresh";
}
