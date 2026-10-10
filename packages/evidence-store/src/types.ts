export interface NewSourcePayload {
  sourceId: string;
  requestUrl: string;
  httpStatus: number;
  contentType: string | null;
  body: Uint8Array;
}

export interface SourcePayload {
  sha256: string;
  sourceId: string;
  requestUrl: string;
  httpStatus: number;
  contentType: string | null;
  recordedAt: Date;
}

export interface ChangeCursor {
  xid: string;
  id: string;
}

export interface StoredPayload {
  sha256: string;
  contentType: string | null;
  body: Buffer;
}

export type Venue = "kraken" | "coinbase" | "bybit";
export type FallbackStep = 1 | 2 | 3 | 4;
export type AttemptOutcome = "trades" | "empty" | "not-listed" | "unavailable" | "rate-limited" | "malformed";
export type PriceRejection = "non_positive_price" | "excess_decimals" | "trade_age_exceeded";
export type IncidentKind =
  | "venue_unavailable"
  | "venue_rate_limited"
  | "venue_malformed"
  | "asset_unresolved"
  | "asset_inadmissible"
  | "snapshot_inadmissible"
  | "archive_late"
  | "listing_changed"
  | "candle_revised";

export interface NewAsset {
  assetId: string;
  position: number;
  krakenWsSymbol: string;
  krakenRestPair: string;
  coinbaseProduct: string | null;
  bybitSymbol: string | null;
}

export interface Asset extends NewAsset {
  recordedAt: Date;
}

export interface NewVenueResponse {
  venue: Venue;
  assetId: string;
  cutoff: number;
  request: string;
  rawSha256: string;
}

export interface VenueResponse extends NewVenueResponse {
  id: string;
  recordedAt: Date;
}

export interface NewVenueAttempt {
  venue: Venue;
  step: FallbackStep;
  outcome: AttemptOutcome;
  rawSha256: string | null;
}

export interface VenueAttempt extends NewVenueAttempt {
  id: string;
  assetId: string;
  cutoff: number;
  recordedAt: Date;
}

export interface NewPriceObservation {
  venue: Venue;
  step: FallbackStep;
  candleStart: number;
  close: string;
  usdtUsd: string | null;
  usdtRawSha256: string | null;
  priceE8: string | null;
  tradeEvidence: string;
  tradeAgeMinutes: number;
  rawSha256: string;
  rejection: PriceRejection | null;
}

export interface PriceObservation extends NewPriceObservation {
  id: string;
  assetId: string;
  cutoff: number;
  admissible: boolean;
  recordedAt: Date;
}

export interface NewAssetResolution {
  assetId: string;
  cutoff: number;
  attempts: NewVenueAttempt[];
  observation: NewPriceObservation | null;
}

export interface AssetResolution {
  attempts: VenueAttempt[];
  observation: PriceObservation | null;
}

export interface NewSnapshot {
  cutoff: number;
  observationIds: string[];
  snapshotDigest: string | null;
  admissible: boolean;
}

export type DigestEncoding = "COX/WIRE/V1";

export interface Snapshot extends NewSnapshot {
  id: string;
  digestEncoding: DigestEncoding | null;
  recordedAt: Date;
}

export interface NewIncident {
  cutoff: number;
  kind: IncidentKind;
  assetId: string | null;
  venue: Venue | null;
  detail: string;
  rawSha256: string | null;
}

export interface Incident extends NewIncident {
  id: string;
  recordedAt: Date;
}

export interface CutoffRecord {
  cutoff: number;
  snapshot: Snapshot | null;
  observations: PriceObservation[];
  attempts: VenueAttempt[];
  responses: VenueResponse[];
  incidents: Incident[];
}

export interface SnapshotChangePage {
  snapshots: Snapshot[];
  cursor: ChangeCursor | null;
}
