import { fetchPreferredOecdSeries, snapshotObservations, type OecdRoute } from "./indicators/sdmx-series.js";
import { PILOT_COUNTRIES } from "./pilot-countries.js";
import { recordRevisions } from "./record-revisions.js";

const YEAR_PATTERN = /^\d{4}$/;

export interface OecdSnapshotIndicator {
  indicatorId: string;
  monthlyRoutes: (startYear: string) => OecdRoute[];
  quarterlyRoutes: (startYear: string) => OecdRoute[];
}

export async function ingestOecdSnapshot(indicator: OecdSnapshotIndicator, startYear: string): Promise<void> {
  if (!YEAR_PATTERN.test(startYear)) throw new Error(`invalid start year: ${startYear}`);
  const iso3Codes = PILOT_COUNTRIES.map((country) => country.iso3);
  const retrievedAt = new Date();

  const seriesByCountry = await fetchPreferredOecdSeries(
    indicator.monthlyRoutes(startYear),
    indicator.quarterlyRoutes(startYear),
    iso3Codes,
  );
  const observations = iso3Codes.flatMap((iso3) =>
    snapshotObservations(iso3, seriesByCountry.get(iso3) ?? [], {
      indicatorId: indicator.indicatorId,
      sourceId: "oecd",
      retrievedAt,
    }),
  );
  const recorded = await recordRevisions(observations);

  const missing = iso3Codes.filter((iso3) => !seriesByCountry.has(iso3));
  const quarterly = iso3Codes.filter((iso3) => seriesByCountry.get(iso3)?.[0]?.FREQ === "Q");

  console.log(
    `${indicator.indicatorId} from ${startYear}: ${seriesByCountry.size}/${iso3Codes.length} pilot countries, ` +
      `${observations.length} values fetched, ${recorded} new or revised recorded`,
  );
  if (quarterly.length > 0) console.log(`native quarterly series used for: ${quarterly.join(", ")}`);
  if (missing.length > 0) console.log(`no data returned for: ${missing.join(", ")}`);
}
