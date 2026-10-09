import { getReleaseBefore, pool, recordSourceRelease, type SourceRelease } from "@eox/evidence-store";
import { aggregateCountry, toObservations, type CountryAggregate } from "../indicators/container-throughput.js";
import { publicationFor } from "../indicators/port-publication.js";
import { PILOT_COUNTRIES } from "../pilot-countries.js";
import { recordPayloads } from "../record-payloads.js";
import { recordRevisions } from "../record-revisions.js";
import {
  fetchCountryPortRecords,
  fetchLatestAvailableDate,
  fetchLayerMetadata,
  PORTWATCH_DATASET,
} from "../sources/portwatch.js";

const requestedDate = process.argv[2];
const before = await fetchLayerMetadata();
const latest = await fetchLatestAvailableDate();
const date = requestedDate ?? latest.date;
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
const after = await fetchLayerMetadata();
await recordPayloads("imf-portwatch", [before.payload, latest.payload, after.payload]);

let release: SourceRelease | null = null;
let previous: SourceRelease | null = null;
if (before.dataLastEditDate === after.dataLastEditDate) {
  release = await recordSourceRelease({
    sourceId: "imf-portwatch",
    dataset: PORTWATCH_DATASET,
    releasedAt: after.dataLastEditDate,
    latestPeriod: latest.date,
    metadataSha256: after.payload.sha256,
    periodsSha256: latest.payload.sha256,
  });
  previous = await getReleaseBefore("imf-portwatch", PORTWATCH_DATASET, release.releasedAt);
}
const publication = publicationFor(date, requestedDate !== undefined, release, previous);
const observations = toObservations(date, aggregates).map((observation) =>
  publication ? { ...observation, publishedAt: publication.publishedAt, releaseId: publication.releaseId } : observation,
);
const recorded = await recordRevisions(observations);

const missing = iso3Codes.filter((iso3) => !aggregates.some((aggregate) => aggregate.iso3 === iso3));
console.log(
  `container_throughput ${date}: ${observations.length}/${iso3Codes.length} pilot countries, ` +
    `${recorded} new or revised recorded`,
);
console.log(
  publication
    ? `publication time ${publication.publishedAt} from PortWatch release ${publication.releaseId}`
    : before.dataLastEditDate !== after.dataLastEditDate
      ? "publication time unknown: PortWatch data changed during this run"
      : "publication time unknown: no earlier release shows this date was absent",
);
if (partial.length > 0) {
  console.log(`partial port coverage (reported/total): ${partial.join(", ")}`);
}
if (missing.length > 0) {
  console.log(`no reported port estimates for: ${missing.join(", ")}`);
}

await pool.end();
