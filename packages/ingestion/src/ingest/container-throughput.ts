import { pool, recordObservation } from "@eox/evidence-store";
import { aggregateByCountry, toObservations } from "../indicators/container-throughput.js";
import { PILOT_COUNTRIES } from "../pilot-countries.js";
import { fetchLatestAvailableDate, fetchPortRecords } from "../sources/portwatch.js";

const requestedDate = process.argv[2];
const date = requestedDate ?? (await fetchLatestAvailableDate());
const iso3Codes = PILOT_COUNTRIES.map((country) => country.iso3);

const records = await fetchPortRecords(iso3Codes, date);
const aggregates = aggregateByCountry(records);
const observations = toObservations(date, aggregates);

for (const observation of observations) {
  await recordObservation(observation);
}

const missing = iso3Codes.filter((iso3) => !aggregates.some((aggregate) => aggregate.iso3 === iso3));

console.log(`container_throughput ${date}: recorded ${observations.length}/${iso3Codes.length} pilot countries`);
if (missing.length > 0) {
  console.log(`no data returned for: ${missing.join(", ")}`);
}

await pool.end();
