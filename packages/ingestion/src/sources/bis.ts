import { fetchSdmxCsv, type SdmxRow } from "./sdmx.js";

const BASE_URL = "https://stats.bis.org/api/v1/data";
const DATAFLOW_PATTERN = /^WS_[A-Z0-9_]+$/;
const KEY_PART_PATTERN = /^[A-Z0-9]+(\.[A-Z0-9]+)*$/;
const REF_AREA_PATTERN = /^[A-Z]{2}$/;
const START_PERIOD_PATTERN = /^\d{4}(-Q[1-4])?$/;

export interface BisQuery {
  dataflow: string;
  keyPrefix: string;
  refAreas: readonly string[];
  keySuffix?: string;
  startPeriod: string;
}

export async function fetchBisData(query: BisQuery): Promise<SdmxRow[]> {
  if (query.refAreas.length === 0) return [];
  if (!DATAFLOW_PATTERN.test(query.dataflow)) throw new Error(`invalid BIS dataflow: ${query.dataflow}`);
  for (const part of [query.keyPrefix, query.keySuffix].filter((value) => value !== undefined)) {
    if (!KEY_PART_PATTERN.test(part)) throw new Error(`invalid BIS key part: ${part}`);
  }
  query.refAreas.forEach((code) => {
    if (!REF_AREA_PATTERN.test(code)) throw new Error(`invalid BIS reference area: ${code}`);
  });
  if (!START_PERIOD_PATTERN.test(query.startPeriod)) throw new Error(`invalid start period: ${query.startPeriod}`);
  const key = [query.keyPrefix, query.refAreas.join("+"), query.keySuffix].filter(Boolean).join(".");
  const params = new URLSearchParams({ startPeriod: query.startPeriod, format: "csv" });
  return fetchSdmxCsv(`${BASE_URL}/${query.dataflow}/${key}?${params.toString()}`, `BIS ${query.dataflow}`);
}

export async function fetchBisPolicyRates(refAreas: readonly string[], startYear: string): Promise<SdmxRow[]> {
  if (!/^\d{4}$/.test(startYear)) throw new Error(`invalid start year: ${startYear}`);
  return fetchBisData({ dataflow: "WS_CBPOL", keyPrefix: "M", refAreas, startPeriod: startYear });
}
