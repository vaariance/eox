import { pool } from "@eox/evidence-store";
import { aggregateCountry, toObservations, type CountryAggregate } from "../indicators/container-throughput.js";
import { PILOT_COUNTRIES } from "../pilot-countries.js";
import { recordPayloads } from "../record-payloads.js";
import { recordRevisions } from "../record-revisions.js";
import { fetchCountryPortRecords, fetchLatestAvailableDate } from "../sources/portwatch.js";

const requestedDate = process.argv[2];
const date = requestedDate ?? (await fetchLatestAvailableDate());
const iso3Codes = PILOT_COUNTRIES.map((country) => country.iso3);

const aggregates: CountryAggregate[] = [];
const partial: string[] = [];
for (const iso3 of iso3Codes) {
  const country = await fetchCountryPortRecords(iso3, date);
  await recordPayloads("imf-portwatch", [country.payload]);
  const aggregate = aggregateCountry(iso3, country);
  if (!aggregate) continue;
  aggregates.push(aggregate);
  if (aggregate.portsReported < aggregate.portsTotal) {
    partial.push(`${iso3} ${aggregate.portsReported}/${aggregate.portsTotal}`);
  }
}

const observations = toObservations(date, aggregates);
const recorded = await recordRevisions(observations);

const missing = iso3Codes.filter((iso3) => !aggregates.some((aggregate) => aggregate.iso3 === iso3));

console.log(
  `container_throughput ${date}: ${observations.length}/${iso3Codes.length} pilot countries, ` +
    `${recorded} new or revised recorded`,
);
if (partial.length > 0) {
  console.log(`partial port coverage (reported/total): ${partial.join(", ")}`);
}
if (missing.length > 0) {
  console.log(`no reported port estimates for: ${missing.join(", ")}`);
}

await pool.end();
