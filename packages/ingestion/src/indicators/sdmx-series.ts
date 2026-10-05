import type { NewObservation } from "@eox/evidence-store";
import { fetchOecdData, type OecdQuery } from "../sources/oecd.js";
import { periodBounds, toStoredDecimal, type SdmxRow } from "../sources/sdmx.js";

export type OecdRoute = Omit<OecdQuery, "refAreas">;

export interface SnapshotTarget {
  indicatorId: string;
  sourceId: string;
  retrievedAt: Date;
}

export function groupByRefArea(rows: readonly SdmxRow[]): Map<string, SdmxRow[]> {
  const groups = new Map<string, SdmxRow[]>();
  for (const row of rows) {
    if (row.OBS_VALUE === "") continue;
    const group = groups.get(row.REF_AREA);
    if (group) group.push(row);
    else groups.set(row.REF_AREA, [row]);
  }
  return groups;
}

function latestPeriodEnd(rows: readonly SdmxRow[]): string {
  return rows.reduce((latest, row) => {
    const { periodEnd } = periodBounds(row.TIME_PERIOD);
    return periodEnd > latest ? periodEnd : latest;
  }, "");
}

export function pickFreshestSeries(candidates: readonly SdmxRow[][]): Map<string, SdmxRow[]> {
  const chosen = new Map<string, SdmxRow[]>();
  for (const rows of candidates) {
    for (const [refArea, series] of groupByRefArea(rows)) {
      const current = chosen.get(refArea);
      if (!current || latestPeriodEnd(series) > latestPeriodEnd(current)) chosen.set(refArea, series);
    }
  }
  return chosen;
}

export async function fetchPreferredOecdSeries(
  primary: readonly OecdRoute[],
  fallback: readonly OecdRoute[],
  refAreas: readonly string[],
): Promise<Map<string, SdmxRow[]>> {
  const primaryRows: SdmxRow[][] = [];
  for (const route of primary) {
    primaryRows.push(await fetchOecdData({ ...route, refAreas }));
  }
  const chosen = pickFreshestSeries(primaryRows);

  const uncovered = refAreas.filter((refArea) => !chosen.has(refArea));
  const fallbackRows: SdmxRow[][] = [];
  for (const route of fallback) {
    if (uncovered.length === 0) break;
    fallbackRows.push(await fetchOecdData({ ...route, refAreas: uncovered }));
  }
  for (const [refArea, series] of pickFreshestSeries(fallbackRows)) chosen.set(refArea, series);
  return chosen;
}

export function snapshotObservations(
  countryIso3: string,
  series: readonly SdmxRow[],
  target: SnapshotTarget,
): NewObservation[] {
  const retrievedOn = target.retrievedAt.toISOString().slice(0, 10);
  const scaled = series.find((row) => row.UNIT_MULT !== undefined && row.UNIT_MULT !== "" && row.UNIT_MULT !== "0");
  if (scaled) throw new Error(`${target.indicatorId} ${countryIso3}: unexpected UNIT_MULT ${scaled.UNIT_MULT}`);
  return series.map((row) => ({
    countryIso3,
    indicatorId: target.indicatorId,
    ...periodBounds(row.TIME_PERIOD),
    value: toStoredDecimal(row.OBS_VALUE),
    sourceId: target.sourceId,
    vintage: `retrieved-${retrievedOn}`,
    publishedAt: target.retrievedAt.toISOString(),
  }));
}
