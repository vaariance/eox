import type { NewObservation } from "@eox/evidence-store";
import { fetchOecdData, type OecdQuery } from "../sources/oecd.js";
import type { FetchedPayload } from "../sources/payload.js";
import { periodBounds, toStoredDecimal, type SdmxResponse, type SdmxRow } from "../sources/sdmx.js";

export type OecdRoute = Omit<OecdQuery, "refAreas">;

export interface SnapshotTarget {
  indicatorId: string;
  sourceId: string;
  retrievedAt: Date;
}

export interface SdmxSeries {
  payloadSha256: string;
  rows: SdmxRow[];
}

export interface PreferredOecdSeries {
  series: Map<string, SdmxSeries>;
  payloads: FetchedPayload[];
}

export function groupByRefArea(response: SdmxResponse): Map<string, SdmxSeries> {
  const groups = new Map<string, SdmxSeries>();
  for (const row of response.rows) {
    if (row.OBS_VALUE === "") continue;
    const group = groups.get(row.REF_AREA);
    if (group) group.rows.push(row);
    else groups.set(row.REF_AREA, { payloadSha256: response.payload.sha256, rows: [row] });
  }
  return groups;
}

function latestPeriodEnd(series: SdmxSeries): string {
  return series.rows.reduce((latest, row) => {
    const { periodEnd } = periodBounds(row.TIME_PERIOD);
    return periodEnd > latest ? periodEnd : latest;
  }, "");
}

export function pickFreshestSeries(candidates: readonly SdmxResponse[]): Map<string, SdmxSeries> {
  const chosen = new Map<string, SdmxSeries>();
  for (const response of candidates) {
    for (const [refArea, series] of groupByRefArea(response)) {
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
): Promise<PreferredOecdSeries> {
  const primaryResponses: SdmxResponse[] = [];
  for (const route of primary) {
    primaryResponses.push(await fetchOecdData({ ...route, refAreas }));
  }
  const series = pickFreshestSeries(primaryResponses);

  const uncovered = refAreas.filter((refArea) => !series.has(refArea));
  const fallbackResponses: SdmxResponse[] = [];
  for (const route of fallback) {
    if (uncovered.length === 0) break;
    fallbackResponses.push(await fetchOecdData({ ...route, refAreas: uncovered }));
  }
  for (const [refArea, fallbackSeries] of pickFreshestSeries(fallbackResponses)) series.set(refArea, fallbackSeries);

  const payloads = [...primaryResponses, ...fallbackResponses].map((response) => response.payload);
  return { series, payloads };
}

export function snapshotObservations(
  countryIso3: string,
  series: SdmxSeries | undefined,
  target: SnapshotTarget,
): NewObservation[] {
  if (!series) return [];
  const retrievedOn = target.retrievedAt.toISOString().slice(0, 10);
  const scaled = series.rows.find((row) => row.UNIT_MULT !== undefined && row.UNIT_MULT !== "" && row.UNIT_MULT !== "0");
  if (scaled) throw new Error(`${target.indicatorId} ${countryIso3}: unexpected UNIT_MULT ${scaled.UNIT_MULT}`);
  return series.rows.map((row) => ({
    countryIso3,
    indicatorId: target.indicatorId,
    ...periodBounds(row.TIME_PERIOD),
    value: toStoredDecimal(row.OBS_VALUE),
    rawValue: row.OBS_VALUE,
    rawSha256: series.payloadSha256,
    sourceId: target.sourceId,
    vintage: `retrieved-${retrievedOn}`,
  }));
}
