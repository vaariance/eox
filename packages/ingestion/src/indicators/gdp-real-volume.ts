import type { NewObservation } from "@eox/evidence-store";
import { periodBounds, toStoredDecimal, type SdmxResponse, type SdmxRow } from "../sources/sdmx.js";

export const GDP_REAL_VOLUME_DATAFLOW = "OECD.SDD.STES,DSD_STES_REVISIONS@DF_STES_REVISIONS,4.0";
export const GDP_REAL_VOLUME_KEY_SUFFIX = "Q.B1GQ_Q...";

const EDITION_PATTERN = /^(\d{4})(0[1-9]|1[0-2])$/;
const MILLIONS_EXPONENT = 6;

function editionStart(edition: string): string {
  const match = EDITION_PATTERN.exec(edition);
  if (!match) throw new Error(`invalid OECD edition: ${edition}`);
  return `${match[1]}-${match[2]}-01T00:00:00Z`;
}

function toMillions(row: SdmxRow): string {
  const unitMultiplier = Number(row.UNIT_MULT || "0");
  if (!Number.isInteger(unitMultiplier) || unitMultiplier < 0 || unitMultiplier > MILLIONS_EXPONENT) {
    throw new Error(`unsupported UNIT_MULT for ${row.REF_AREA}: ${row.UNIT_MULT}`);
  }
  return toStoredDecimal(row.OBS_VALUE, MILLIONS_EXPONENT - unitMultiplier);
}

export function toObservations(response: SdmxResponse): NewObservation[] {
  return response.rows
    .filter(
      (row) =>
        row.MEASURE === "B1GQ_Q" &&
        row.FREQ === "Q" &&
        row.UNIT_MEASURE === "XDC" &&
        row.ACTIVITY === "_T" &&
        row.OBS_VALUE !== "",
    )
    .map((row) => {
      const editionAt = editionStart(row.EDITION);
      return {
        countryIso3: row.REF_AREA,
        indicatorId: "gdp_real_volume",
        ...periodBounds(row.TIME_PERIOD),
        value: toMillions(row),
        rawValue: row.OBS_VALUE,
        rawSha256: response.payload.sha256,
        sourceId: "oecd",
        vintage: `oecd-edition-${row.EDITION}`,
        knownAt: editionAt,
      };
    });
}
