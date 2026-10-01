import type { NewObservation } from "@eox/evidence-store";
import type { PortRecord } from "../sources/portwatch.js";

export interface CountryAggregate {
  iso3: string;
  tonnage: number;
}

export function aggregateByCountry(records: readonly PortRecord[]): CountryAggregate[] {
  const totals = new Map<string, number>();
  for (const record of records) {
    const imports = record.importContainer ?? 0;
    const exports = record.exportContainer ?? 0;
    totals.set(record.iso3, (totals.get(record.iso3) ?? 0) + imports + exports);
  }
  return [...totals.entries()].map(([iso3, tonnage]) => ({ iso3, tonnage }));
}

export function toObservations(date: string, aggregates: readonly CountryAggregate[]): NewObservation[] {
  return aggregates.map((aggregate) => ({
    countryIso3: aggregate.iso3,
    indicatorId: "container_throughput",
    periodStart: date,
    periodEnd: date,
    value: String(aggregate.tonnage),
    sourceId: "imf-portwatch",
    vintage: "daily_estimate",
    publishedAt: `${date}T00:00:00Z`,
  }));
}
