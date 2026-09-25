import type { Observation, Query } from "@eox/evidence-store";

export type OfficialSources = Record<string, Record<string, string>>;

export type AsOfFetcher = (query: Query, asOf: Date) => Promise<Observation[]>;

export interface ExportParams {
  asOf: Date;
  periodStart: string;
  periodEnd: string;
  officialSources: OfficialSources;
}

export interface SnapshotObservation {
  country_iso3: string;
  indicator_id: string;
  period_start: string;
  period_end: string;
  value: string;
  source_id: string;
  vintage: string;
  published_at: string;
  known_at: string;
  recipe_id: number | null;
  raw_sha256: string | null;
}

export interface SnapshotFile {
  as_of: string;
  observations: SnapshotObservation[];
  evidence_root: number[];
}

export async function exportSnapshot(
  fetchAsOf: AsOfFetcher,
  { asOf, periodStart, periodEnd, officialSources }: ExportParams,
): Promise<SnapshotFile> {
  const observations: SnapshotObservation[] = [];

  for (const countryIso3 of Object.keys(officialSources).sort()) {
    const indicators = officialSources[countryIso3];
    for (const indicatorId of Object.keys(indicators).sort()) {
      const sourceId = indicators[indicatorId];
      const rows = await fetchAsOf({ countryIso3, indicatorId, sourceId }, asOf);
      const official = rows.filter(
        (row) =>
          row.sourceId === sourceId &&
          row.periodStart === periodStart &&
          row.periodEnd === periodEnd,
      );
      if (official.length > 1) {
        throw new Error(
          `Expected one ${sourceId} row for ${countryIso3}/${indicatorId} ${periodStart}..${periodEnd}, got ${official.length}`,
        );
      }
      if (official.length === 1) observations.push(toSnapshotObservation(official[0]));
    }
  }

  return {
    as_of: asOf.toISOString(),
    observations,
    evidence_root: new Array<number>(32).fill(0),
  };
}

function toSnapshotObservation(row: Observation): SnapshotObservation {
  return {
    country_iso3: row.countryIso3,
    indicator_id: row.indicatorId,
    period_start: row.periodStart,
    period_end: row.periodEnd,
    value: row.value,
    source_id: row.sourceId,
    vintage: row.vintage,
    published_at: row.publishedAt.toISOString(),
    known_at: row.knownAt.toISOString(),
    recipe_id: row.recipeId,
    raw_sha256: row.rawSha256,
  };
}
