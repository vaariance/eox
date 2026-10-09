import type { Observation } from "@eox/evidence-store";
import {
  COUNTRIES,
  INDICATORS,
  periodOrdinal,
  seriesDescriptor,
  seriesIdentity,
  type Country,
  type Frequency,
  type Indicator,
} from "@eox/methodology";

const RECORD_PREFIX = "eox:observation:";
const RECORD_ID_PATTERN = /^eox:observation:([1-9][0-9]{0,18})$/;

export interface EvidenceFact {
  recordId: string;
  seriesId: string;
  revisionId: string;
  country: string;
  countryIso3: string;
  indicator: string;
  source: string;
  unit: string;
  frequency: Frequency;
  period: string;
  periodOrdinal: string;
  value: string;
  rawValue: string | null;
  publishedAt: number | null;
  knownAt: number;
  recordedAt: number;
  artifactDigest: string;
  coverage: { reported: number; total: number } | null;
  revision: {
    revises: string | null;
    orderBasis: "source-edition" | "retrieval";
    sourceEdition: string | null;
  };
  supersedes: string | null;
  publication: PublicationEvidence | null;
}

export interface ReleaseEvidence {
  releasedAtMs: number;
  latestPeriod: string;
  metadataDigest: string;
  periodsDigest: string;
}

export interface PublicationEvidence {
  basis: "source-data-edit";
  release: ReleaseEvidence;
  previousRelease: ReleaseEvidence;
}

const EDITION_VINTAGE = /^oecd-edition-([0-9]{6})$/;

export function toRecordId(observationId: string): string {
  return `${RECORD_PREFIX}${observationId}`;
}

export function parseRecordId(recordId: string): string | null {
  return RECORD_ID_PATTERN.exec(recordId)?.[1] ?? null;
}

function unixSeconds(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

function exactSeconds(value: Date): number | null {
  const millis = value.getTime();
  return millis % 1000 === 0 ? millis / 1000 : null;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nativePeriod(frequency: Frequency, periodStart: string, periodEnd: string): string | null {
  const [year, month, day] = periodStart.split("-").map(Number) as [number, number, number];
  if (frequency === "daily") return periodStart === periodEnd ? periodStart : null;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (day !== 1) return null;
  if (frequency === "monthly") {
    const end = `${year}-${pad(month)}-${pad(lastDayOfMonth(year, month))}`;
    return periodEnd === end ? `${year}-${pad(month)}` : null;
  }
  if ((month - 1) % 3 !== 0) return null;
  const end = `${year}-${pad(month + 2)}-${pad(lastDayOfMonth(year, month + 2))}`;
  return periodEnd === end ? `${year}-Q${(month - 1) / 3 + 1}` : null;
}

function catalogueCountry(iso3: string): readonly [Country, string] | null {
  return COUNTRIES.find(([country]) => country === iso3) ?? null;
}

export function toEvidenceFact(observation: Observation): EvidenceFact | null {
  const country = catalogueCountry(observation.countryIso3);
  if (!country || !INDICATORS.includes(observation.indicatorId as Indicator)) return null;
  if (observation.rawSha256 === null) return null;
  const descriptor = seriesDescriptor(country[0], observation.indicatorId as Indicator);
  if (descriptor.source !== observation.sourceId) return null;
  const period = nativePeriod(descriptor.frequency, observation.periodStart, observation.periodEnd);
  if (period === null) return null;
  return {
    recordId: toRecordId(observation.id),
    seriesId: seriesIdentity(descriptor.country, descriptor.indicator),
    revisionId: observation.vintage,
    country: country[1],
    countryIso3: descriptor.country,
    indicator: descriptor.indicator,
    source: descriptor.source,
    unit: descriptor.unit,
    frequency: descriptor.frequency,
    period,
    periodOrdinal: periodOrdinal(descriptor.frequency, period),
    value: observation.value,
    rawValue: observation.rawValue,
    publishedAt: observation.publishedAt === null ? null : exactSeconds(new Date(observation.publishedAt)),
    knownAt: unixSeconds(new Date(observation.knownAt)),
    recordedAt: unixSeconds(new Date(observation.recordedAt)),
    artifactDigest: observation.rawSha256,
    coverage:
      observation.coverageReported === null || observation.coverageTotal === null
        ? null
        : { reported: observation.coverageReported, total: observation.coverageTotal },
    revision: {
      revises: observation.revisesId === null ? null : toRecordId(observation.revisesId),
      orderBasis: EDITION_VINTAGE.test(observation.vintage) ? "source-edition" : "retrieval",
      sourceEdition: EDITION_VINTAGE.exec(observation.vintage)?.[1] ?? null,
    },
    supersedes: observation.supersedesId === null ? null : toRecordId(observation.supersedesId),
    publication: null,
  };
}
