export type Decimal = string;

export interface NewObservation {
  countryIso3: string;
  indicatorId: string;
  periodStart: string;
  periodEnd: string;
  value: Decimal | number;
  sourceId: string;
  vintage: string;
  publishedAt?: string;
  knownAt?: string;
  recipeId?: number;
  rawSha256?: string;
  rawValue?: string;
  coverageReported?: number;
  coverageTotal?: number;
  revisesId?: string;
  releaseId?: string;
}

export interface Observation {
  id: string;
  countryIso3: string;
  indicatorId: string;
  periodStart: string;
  periodEnd: string;
  value: Decimal;
  sourceId: string;
  vintage: string;
  publishedAt: Date | null;
  knownAt: Date;
  recordedAt: Date;
  recipeId: number | null;
  rawSha256: string | null;
  rawValue: string | null;
  coverageReported: number | null;
  coverageTotal: number | null;
  revisesId: string | null;
  releaseId: string | null;
  supersedesId: string | null;
  correctionReason: string | null;
}

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

export interface Query {
  countryIso3: string;
  indicatorId: string;
  sourceId?: string;
}

export interface ChangeCursor {
  xid: string;
  id: string;
}

export interface ChangePage {
  observations: Observation[];
  cursor: ChangeCursor | null;
}

export interface StoredPayload {
  sha256: string;
  contentType: string | null;
  body: Buffer;
}

export interface NewSourceRelease {
  sourceId: string;
  dataset: string;
  releasedAt: string;
  latestPeriod: string;
  metadataSha256: string;
  periodsSha256: string;
}

export interface SourceRelease extends Omit<NewSourceRelease, "releasedAt"> {
  id: string;
  releasedAt: Date;
  recordedAt: Date;
}


export interface Asset {
  assetId: string;
  feedId: string;
  symbol: string;
  quote: string;
  recordedAt: Date;
}

export type PriceRejection =
  | "outside_window"
  | "unsynchronised"
  | "exponent_mismatch"
  | "non_positive_price"
  | "confidence_bound";

export type IncidentKind = "fetch_failed" | "decode_failed" | "missing_feed" | "unexpected_feed" | "inadmissible_snapshot";

export interface NewPriceObservation {
  assetId: string;
  feedId: string;
  price: string;
  conf: string;
  expo: number;
  publishTime: number;
  prevPublishTime: number;
  rejection: PriceRejection | null;
}

export interface PriceObservation extends Omit<NewPriceObservation, "rejection"> {
  id: string;
  priceUpdateId: string;
  cutoff: number;
  rawSha256: string;
  recordedAt: Date;
  admissible: boolean;
  rejection: PriceRejection | null;
}

export interface NewPriceUpdate {
  cutoff: number;
  rawSha256: string;
  feedIds: string[];
  observations: NewPriceObservation[];
}

export interface PriceUpdate {
  id: string;
  cutoff: number;
  rawSha256: string;
  feedIds: string[];
  recordedAt: Date;
  observations: PriceObservation[];
}

export interface NewIncident {
  cutoff: number;
  kind: IncidentKind;
  detail: string;
  rawSha256: string | null;
}

export interface Incident extends NewIncident {
  id: string;
  recordedAt: Date;
}

export interface PriceChangePage {
  observations: PriceObservation[];
  cursor: ChangeCursor | null;
}
