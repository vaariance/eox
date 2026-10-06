import type { NewObservation } from "@eox/evidence-store";
import type { CountryPortPayload, PortRecord } from "../sources/portwatch.js";

export interface CountryAggregate {
  iso3: string;
  tonnage: number;
  portsReported: number;
  portsTotal: number;
  payloadSha256: string;
}

function isReported(record: PortRecord): boolean {
  return record.importContainer !== null && record.exportContainer !== null;
}

export function aggregateCountry(iso3: string, country: CountryPortPayload): CountryAggregate | null {
  const reported = country.records.filter(isReported);
  if (reported.length === 0) return null;
  const tonnage = reported.reduce(
    (total, record) => total + (record.importContainer as number) + (record.exportContainer as number),
    0,
  );
  return {
    iso3,
    tonnage,
    portsReported: reported.length,
    portsTotal: country.records.length,
    payloadSha256: country.payload.sha256,
  };
}

export function toObservations(date: string, aggregates: readonly CountryAggregate[]): NewObservation[] {
  return aggregates.map((aggregate) => ({
    countryIso3: aggregate.iso3,
    indicatorId: "container_throughput",
    periodStart: date,
    periodEnd: date,
    value: aggregate.tonnage.toFixed(6),
    sourceId: "imf-portwatch",
    vintage: "daily_estimate",
    rawSha256: aggregate.payloadSha256,
    coverageReported: aggregate.portsReported,
    coverageTotal: aggregate.portsTotal,
  }));
}
