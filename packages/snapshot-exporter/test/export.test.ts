import { describe, expect, it } from "vitest";
import type { Observation, Query } from "@eox/evidence-store";
import { exportSnapshot, type AsOfFetcher } from "../src/export.js";

const asOf = new Date("2025-04-15T00:00:00Z");
const period = { periodStart: "2025-01-01", periodEnd: "2025-03-31" };

function row(overrides: Partial<Observation>): Observation {
  return {
    id: "1",
    countryIso3: "NGA",
    indicatorId: "cpi_core_yoy",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    value: "24.5",
    sourceId: "nbs",
    vintage: "first",
    publishedAt: new Date("2025-04-10T00:00:00Z"),
    knownAt: new Date("2025-04-11T00:00:00Z"),
    recipeId: 1,
    rawSha256: "ab".repeat(32),
    supersedesId: null,
    correctionReason: null,
    ...overrides,
  };
}

function fetcherOver(rows: Observation[]): AsOfFetcher {
  return async (q: Query) =>
    rows.filter(
      (r) =>
        r.countryIso3 === q.countryIso3 &&
        r.indicatorId === q.indicatorId &&
        (q.sourceId === undefined || r.sourceId === q.sourceId),
    );
}

describe("exportSnapshot", () => {
  const officialSources = { NGA: { cpi_core_yoy: "nbs" } };

  it("keeps only the official source row for the epoch period", async () => {
    const fetchAsOf = fetcherOver([
      row({ id: "1" }),
      row({ id: "2", sourceId: "imf", value: "22.0" }),
      row({ id: "3", periodStart: "2024-10-01", periodEnd: "2024-12-31", value: "20.0" }),
    ]);

    const snapshot = await exportSnapshot(fetchAsOf, { asOf, ...period, officialSources });

    expect(snapshot.observations).toHaveLength(1);
    expect(snapshot.observations[0]).toMatchObject({
      country_iso3: "NGA",
      source_id: "nbs",
      value: "24.5",
      raw_sha256: "ab".repeat(32),
    });
    expect(snapshot.evidence_root).toEqual(new Array(32).fill(0));
  });

  it("emits nothing when the official source has no row, never falling back to a mirror", async () => {
    const fetchAsOf: AsOfFetcher = async (q) =>
      q.sourceId === "imf" ? [row({ sourceId: "imf" })] : [];
    const mirrorOnly = fetcherOver([row({ sourceId: "imf", value: "22.0" })]);

    for (const fetcher of [fetchAsOf, mirrorOnly]) {
      const snapshot = await exportSnapshot(fetcher, { asOf, ...period, officialSources });
      expect(snapshot.observations).toEqual([]);
    }
  });

  it("orders observations by country and indicator", async () => {
    const fetchAsOf = fetcherOver([
      row({ countryIso3: "USA", sourceId: "bls" }),
      row({ countryIso3: "NGA" }),
    ]);

    const snapshot = await exportSnapshot(fetchAsOf, {
      asOf,
      ...period,
      officialSources: { USA: { cpi_core_yoy: "bls" }, NGA: { cpi_core_yoy: "nbs" } },
    });

    expect(snapshot.observations.map((o) => o.country_iso3)).toEqual(["NGA", "USA"]);
  });
});
