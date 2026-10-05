import type { NewObservation } from "@eox/evidence-store";
import type { PilotCountry } from "../pilot-countries.js";
import type { SdmxResponse } from "../sources/sdmx.js";
import { groupByRefArea, snapshotObservations } from "./sdmx-series.js";

const EURO_AREA_REF_AREA = "XM";

const EURO_ADOPTION_DATES: Readonly<Record<string, string>> = {
  BEL: "1999-01-01",
  DEU: "1999-01-01",
  ESP: "1999-01-01",
  FIN: "1999-01-01",
  FRA: "1999-01-01",
  IRL: "1999-01-01",
  ITA: "1999-01-01",
  NLD: "1999-01-01",
  PRT: "1999-01-01",
  GRC: "2001-01-01",
  SVN: "2007-01-01",
  EST: "2011-01-01",
  LVA: "2014-01-01",
  LTU: "2015-01-01",
};

export function policyRateRefArea(country: PilotCountry): string {
  return country.iso3 in EURO_ADOPTION_DATES ? EURO_AREA_REF_AREA : country.iso2;
}

export function toObservations(
  countries: readonly PilotCountry[],
  response: SdmxResponse,
  retrievedAt: Date,
): NewObservation[] {
  const seriesByRefArea = groupByRefArea(response);
  return countries.flatMap((country) => {
    const series = seriesByRefArea.get(policyRateRefArea(country));
    const adoption = EURO_ADOPTION_DATES[country.iso3];
    return snapshotObservations(country.iso3, series, {
      indicatorId: "policy_rate",
      sourceId: "bis",
      retrievedAt,
    }).filter((observation) => !adoption || observation.periodStart >= adoption);
  });
}
