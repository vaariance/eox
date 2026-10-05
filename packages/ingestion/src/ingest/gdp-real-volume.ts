import { pool } from "@eox/evidence-store";
import { GDP_REAL_VOLUME_DATAFLOW, GDP_REAL_VOLUME_KEY_SUFFIX, toObservations } from "../indicators/gdp-real-volume.js";
import { PILOT_COUNTRIES } from "../pilot-countries.js";
import { recordPayloads } from "../record-payloads.js";
import { recordRevisions } from "../record-revisions.js";
import { fetchOecdData } from "../sources/oecd.js";

const startPeriod = process.argv[2] ?? "2021-Q1";
const iso3Codes = PILOT_COUNTRIES.map((country) => country.iso3);

const response = await fetchOecdData({
  dataflow: GDP_REAL_VOLUME_DATAFLOW,
  keySuffix: GDP_REAL_VOLUME_KEY_SUFFIX,
  refAreas: iso3Codes,
  startPeriod,
});
const observations = toObservations(response).filter((observation) => iso3Codes.includes(observation.countryIso3));
await recordPayloads("oecd", [response.payload]);
const recorded = await recordRevisions(observations);

const covered = new Set(observations.map((observation) => observation.countryIso3));
const missing = iso3Codes.filter((iso3) => !covered.has(iso3));

console.log(
  `gdp_real_volume from ${startPeriod}: ${covered.size}/${iso3Codes.length} pilot countries, ` +
    `${observations.length} edition values fetched, ${recorded} new or revised recorded`,
);
if (missing.length > 0) {
  console.log(`no data returned for: ${missing.join(", ")}`);
}

await pool.end();
