export type UnixSeconds = number;

export const COX_APP_API_SCHEMA_VERSION = "cox.app-api/v1";
export const COX_PRICE_SCALE = "100000000";
export const COX_SCALE = "1000000000000";
export const COX_REFERENCE_BASE = "100000000000000";
export const COX_TRANSFER_RULE = "COX/TRANSFER/MVP-0";
export const BATCH_SECONDS = 60;
export const ARCHIVE_DEADLINE_SECONDS = 30;
export const ACCEPTANCE_DEADLINE_SECONDS = 55;
export const MAX_TRADE_AGE_MINUTES = 30;
export const DELAYED_AFTER_MISSED_CUTOFFS = 3;
export const HALTED_AFTER_MISSED_CUTOFFS = 60;
export const CRYPTO_CLASS = "CRYPTO";

export type CoxOrigin = "fixture" | "live";
export type Scaled = string;
export type BaseUnits = string;
export type UnitQuanta = string;
export type ClassId = string;
export type PriceVenue = "kraken" | "coinbase" | "bybit";
export type FallbackStep = 1 | 2 | 3 | 4;

export interface Methodology {
  digest: string | null;
  label: string;
  status: "draft" | "sealed";
  assetCount: number;
}

export interface CoxDeployment {
  origin: CoxOrigin;
  network: string;
  program: string | null;
  poolId: string;
  poolAddress: string | null;
  collateralMint: string | null;
  collateralDecimals: number | null;
  testCollateral: true;
  transferRule: typeof COX_TRANSFER_RULE;
  methodology: Methodology;
  fixtureSource: string | null;
}

export interface VenueSymbols {
  krakenWs: string | null;
  krakenRest: string | null;
  coinbase: string | null;
  bybit: string | null;
}

export interface CoxAsset {
  assetId: string;
  classIndex: number;
  name: string;
  venues: VenueSymbols;
  latest: { sequence: number; batch: number; priceE8: Scaled; venue: PriceVenue; step: FallbackStep; tradeAgeMinutes: number } | null;
}

export interface CryptoMember {
  assetId: string;
  weightNumerator: string;
  weightDenominator: string;
}

export interface CryptoComposition {
  label: string;
  methodologyDigest: string | null;
  members: CryptoMember[];
}

export interface PublicationIdentity {
  program: string | null;
  poolId: string;
  sequence: number;
  batch: number;
  predecessorSequence: number | null;
  predecessorBatch: number | null;
  missedBatches: number[];
  cutoff: UnixSeconds;
  manifestDigest: string | null;
  snapshotDigest: string | null;
  stateDigest: string | null;
  committedAt: UnixSeconds | null;
  finalization: { transaction: string | null; slot: number | null; finalized: boolean };
}

export interface PublishedPrice {
  assetId: string;
  priceE8: Scaled;
  venue: PriceVenue;
  step: FallbackStep;
  candleStart: UnixSeconds;
  tradeAgeMinutes: number;
}

export interface AssetReference {
  assetId: string;
  gross: Scaled | null;
  reference: Scaled;
}

export interface ClassState {
  backing: BaseUnits;
  units: UnitQuanta;
}

export interface ClassValuation {
  classId: ClassId;
  classIndex: number;
  transferFactor: Scaled | null;
  preRevaluation: ClassState;
  fixed: ClassState;
  final: ClassState;
}

export interface LedgerTotals {
  active: BaseUnits;
  pending: BaseUnits;
  refundable: BaseUnits;
  payable: BaseUnits;
  residual: BaseUnits;
  vault: BaseUnits;
}

export interface BatchFlows {
  acceptedDeposits: BaseUnits;
  newPayable: BaseUnits;
  transferResidual: BaseUnits;
  flowResidual: BaseUnits;
  executed: number;
  rejected: number;
}

export interface Publication {
  identity: PublicationIdentity;
  prices: PublishedPrice[];
  benchmarkGross: Scaled | null;
  benchmark: Scaled;
  references: AssetReference[];
  classes: ClassValuation[];
  flows: BatchFlows;
  ledger: LedgerTotals;
  receiptRoot: string | null;
}

export interface Batch {
  batch: number;
  cutoff: UnixSeconds;
  acceptanceDeadline: UnixSeconds;
}

export type SystemState = "fresh" | "delayed" | "halted" | "incident" | "paused";
export type MonitorVerdict = "match" | "mismatch" | "pending";

export interface CoxStatus {
  asOf: UnixSeconds;
  latestSequence: number | null;
  latestBatch: number | null;
  latestCutoff: UnixSeconds | null;
  ageSeconds: number | null;
  missedCutoffs: number;
  state: SystemState;
  executing: boolean;
  monitor: { sequence: number; verdict: MonitorVerdict } | null;
  currentBatch: Batch | null;
}

export type RequestOperation = "deposit" | "switch" | "redeem";
export type ReceiptStatus = "filled" | "condition-failed" | "expired" | "zero-value-class";
export type RequestState = "queued" | ReceiptStatus | "cancelled" | "refunded";

export interface Receipt {
  requestId: string;
  sequence: number;
  batch: number;
  status: ReceiptStatus;
  minted: UnitQuanta;
  proceeds: BaseUnits;
}

export interface CoxRequest {
  requestId: string;
  owner: string;
  operation: RequestOperation;
  fromClass: ClassId | null;
  toClass: ClassId | null;
  amount: BaseUnits | null;
  units: UnitQuanta | null;
  minimumUnits: UnitQuanta | null;
  minimumProceeds: BaseUnits | null;
  targetBatch: number;
  expiryBatch: number;
  state: RequestState;
  receipt: Receipt | null;
}

export interface Position {
  classId: ClassId;
  units: UnitQuanta;
  locked: UnitQuanta;
}

export interface Portfolio {
  owner: string;
  appliedSequence: number | null;
  positions: Position[];
  payable: BaseUnits;
  refundable: BaseUnits;
  pending: BaseUnits;
  requests: CoxRequest[];
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
  | "UNKNOWN_WALLET"
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
  const batch = now < origin ? 0 : Math.floor((now - origin) / BATCH_SECONDS) + 1;
  const cutoff = origin + batch * BATCH_SECONDS;
  return { batch, cutoff, acceptanceDeadline: cutoff + ACCEPTANCE_DEADLINE_SECONDS };
}

export function systemState(missedCutoffs: number, paused: boolean, incident: boolean): SystemState {
  if (paused) return "paused";
  if (missedCutoffs >= HALTED_AFTER_MISSED_CUTOFFS) return "halted";
  if (incident) return "incident";
  if (missedCutoffs >= DELAYED_AFTER_MISSED_CUTOFFS) return "delayed";
  return "fresh";
}
