export type Decimal = string;

export interface NewObservation {
  countryIso3: string;
  indicatorId: string;
  periodStart: string;
  periodEnd: string;
  value: Decimal | number;
  sourceId: string;
  vintage: string;
  publishedAt: string;
  knownAt?: string;
  recipeId?: number;
  rawSha256?: string;
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
  publishedAt: Date;
  knownAt: Date;
  recipeId: number | null;
  rawSha256: string | null;
  supersedesId: string | null;
  correctionReason: string | null;
}

export interface Query {
  countryIso3: string;
  indicatorId: string;
  sourceId?: string;
}
