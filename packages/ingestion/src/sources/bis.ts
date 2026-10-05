import { fetchSdmxCsv, type SdmxRow } from "./sdmx.js";

const BASE_URL = "https://stats.bis.org/api/v1/data/WS_CBPOL";
const REF_AREA_PATTERN = /^[A-Z]{2}$/;
const YEAR_PATTERN = /^\d{4}$/;

export async function fetchBisPolicyRates(refAreas: readonly string[], startYear: string): Promise<SdmxRow[]> {
  if (refAreas.length === 0) return [];
  refAreas.forEach((code) => {
    if (!REF_AREA_PATTERN.test(code)) throw new Error(`invalid BIS reference area: ${code}`);
  });
  if (!YEAR_PATTERN.test(startYear)) throw new Error(`invalid start year: ${startYear}`);
  const params = new URLSearchParams({ startPeriod: startYear, format: "csv" });
  const url = `${BASE_URL}/M.${refAreas.join("+")}?${params.toString()}`;
  return fetchSdmxCsv(url, "BIS WS_CBPOL");
}
