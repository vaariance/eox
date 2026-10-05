import { fetchSdmxCsv, type SdmxRow } from "./sdmx.js";

const BASE_URL = "https://sdmx.oecd.org/public/rest/data";
const ISO3_PATTERN = /^[A-Z]{3}$/;
const START_PERIOD_PATTERN = /^\d{4}(-(0[1-9]|1[0-2])|-Q[1-4])?$/;

export interface OecdQuery {
  dataflow: string;
  keySuffix: string;
  refAreas: readonly string[];
  startPeriod: string;
}

export async function fetchOecdData(query: OecdQuery): Promise<SdmxRow[]> {
  if (query.refAreas.length === 0) return [];
  query.refAreas.forEach((code) => {
    if (!ISO3_PATTERN.test(code)) throw new Error(`invalid ISO3 code: ${code}`);
  });
  if (!START_PERIOD_PATTERN.test(query.startPeriod)) {
    throw new Error(`invalid start period: ${query.startPeriod}`);
  }
  const key = `${query.refAreas.join("+")}.${query.keySuffix}`;
  const params = new URLSearchParams({ startPeriod: query.startPeriod, format: "csvfile" });
  const url = `${BASE_URL}/${query.dataflow}/${key}?${params.toString()}`;
  return fetchSdmxCsv(url, `OECD ${query.dataflow}`);
}
