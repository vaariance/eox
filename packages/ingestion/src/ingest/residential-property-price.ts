import { pool } from "@eox/evidence-store";
import { residentialPropertyPriceQuery, toObservations } from "../indicators/residential-property-price.js";
import { PILOT_COUNTRIES } from "../pilot-countries.js";
import { recordPayloads } from "../record-payloads.js";
import { recordRevisions } from "../record-revisions.js";
import { fetchBisData } from "../sources/bis.js";

const startYear = process.argv[2] ?? "2021";
if (!/^\d{4}$/.test(startYear)) throw new Error(`invalid start year: ${startYear}`);

const response = await fetchBisData(residentialPropertyPriceQuery(PILOT_COUNTRIES, startYear));
const observations = toObservations(PILOT_COUNTRIES, response, new Date());
await recordPayloads("bis", [response.payload]);
const recorded = await recordRevisions(observations);

const covered = new Set(observations.map((observation) => observation.countryIso3));
const missing = PILOT_COUNTRIES.map((country) => country.iso3).filter((iso3) => !covered.has(iso3));

console.log(
  `residential_property_price_real from ${startYear}: ${covered.size}/${PILOT_COUNTRIES.length} pilot countries, ` +
    `${observations.length} values fetched, ${recorded} new or revised recorded`,
);
if (missing.length > 0) {
  console.log(`no data returned for: ${missing.join(", ")}`);
}

await pool.end();
