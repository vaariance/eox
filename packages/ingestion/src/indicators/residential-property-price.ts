import type { NewObservation } from "@eox/evidence-store";
import type { PilotCountry } from "../pilot-countries.js";
import type { BisQuery } from "../sources/bis.js";
import type { SdmxResponse } from "../sources/sdmx.js";
import { groupByRefArea, snapshotObservations } from "./sdmx-series.js";

export function residentialPropertyPriceQuery(
  countries: readonly PilotCountry[],
  startYear: string,
): BisQuery {
  return {
    dataflow: "WS_SPP",
    keyPrefix: "Q",
    refAreas: countries.map((country) => country.iso2),
    keySuffix: "R.628",
    startPeriod: `${startYear}-Q1`,
  };
}

export function toObservations(
  countries: readonly PilotCountry[],
  response: SdmxResponse,
  retrievedAt: Date,
): NewObservation[] {
  const seriesByRefArea = groupByRefArea({
    payload: response.payload,
    rows: response.rows.filter((row) => row.FREQ === "Q" && row.VALUE === "R" && row.UNIT_MEASURE === "628"),
  });
  return countries.flatMap((country) =>
    snapshotObservations(country.iso3, seriesByRefArea.get(country.iso2), {
      indicatorId: "residential_property_price_real",
      sourceId: "bis",
      retrievedAt,
    }),
  );
}
