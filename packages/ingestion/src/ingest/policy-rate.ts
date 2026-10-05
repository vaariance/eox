import { pool } from "@eox/evidence-store";
import { policyRateRefArea, toObservations } from "../indicators/policy-rate.js";
import { PILOT_COUNTRIES } from "../pilot-countries.js";
import { recordRevisions } from "../record-revisions.js";
import { fetchBisPolicyRates } from "../sources/bis.js";

const startYear = process.argv[2] ?? "2021";
const refAreas = [...new Set(PILOT_COUNTRIES.map(policyRateRefArea))];

const rows = await fetchBisPolicyRates(refAreas, startYear);
const observations = toObservations(PILOT_COUNTRIES, rows, new Date());
const recorded = await recordRevisions(observations);

const covered = new Set(observations.map((observation) => observation.countryIso3));
const missing = PILOT_COUNTRIES.map((country) => country.iso3).filter((iso3) => !covered.has(iso3));

console.log(
  `policy_rate from ${startYear}: ${covered.size}/${PILOT_COUNTRIES.length} pilot countries, ` +
    `${observations.length} values fetched, ${recorded} new or revised recorded`,
);
if (missing.length > 0) {
  console.log(`no data returned for: ${missing.join(", ")}`);
}

await pool.end();
