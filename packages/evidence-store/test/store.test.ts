import { afterAll, describe, expect, it } from "vitest";
import { getAsOf, getHistory, getLatest, pool, recordCorrection, recordObservation } from "../src/index.js";

afterAll(async () => {
  await pool.end();
});

describe("recordObservation and time-travel queries", () => {
  const q = { countryIso3: "NGA", indicatorId: "gdp_real_growth_yoy", sourceId: "nbs-ng" };
  const period = { periodStart: "2025-01-01", periodEnd: "2025-03-31" };

  it("returns the newest version known as of a given date", async () => {
    await recordObservation({
      ...q,
      ...period,
      value: "3.2",
      vintage: "first",
      publishedAt: "2025-05-30T10:00:00Z",
      knownAt: "2025-05-30T10:00:00Z",
    });
    await recordObservation({
      ...q,
      ...period,
      value: "2.9",
      vintage: "second",
      publishedAt: "2025-06-30T10:00:00Z",
      knownAt: "2025-06-30T10:00:00Z",
    });

    const asOfJune15 = await getAsOf(q, "2025-06-15");
    expect(asOfJune15).toHaveLength(1);
    expect(asOfJune15[0].value).toBe("3.200000");
    expect(asOfJune15[0].vintage).toBe("first");

    const latest = await getLatest(q);
    expect(latest).toHaveLength(1);
    expect(latest[0].value).toBe("2.900000");
    expect(latest[0].vintage).toBe("second");
  });

  it("preserves every version in history, oldest first", async () => {
    const history = await getHistory(q, period.periodStart);
    expect(history.map((r) => r.vintage)).toEqual(["first", "second"]);
  });
});

describe("recordCorrection", () => {
  it("requires a non-empty reason", async () => {
    const bad = await recordObservation({
      countryIso3: "USA",
      indicatorId: "cpi_core_yoy",
      periodStart: "2025-01-01",
      periodEnd: "2025-01-31",
      value: "3.0",
      sourceId: "bls-us",
      vintage: "first",
      publishedAt: "2025-02-15T00:00:00Z",
    });

    await expect(
      recordCorrection(
        bad.id,
        {
          countryIso3: "USA",
          indicatorId: "cpi_core_yoy",
          periodStart: "2025-01-01",
          periodEnd: "2025-01-31",
          value: "3.1",
          sourceId: "bls-us",
          vintage: "fix",
          publishedAt: "2025-02-15T00:00:00Z",
        },
        "",
      ),
    ).rejects.toThrow("A correction needs a reason");
  });

  it("links a correction to the row it fixes", async () => {
    const bad = await recordObservation({
      countryIso3: "USA",
      indicatorId: "cpi_core_yoy",
      periodStart: "2025-02-01",
      periodEnd: "2025-02-28",
      value: "3.0",
      sourceId: "bls-us",
      vintage: "first",
      publishedAt: "2025-03-15T00:00:00Z",
    });

    const fixed = await recordCorrection(
      bad.id,
      {
        countryIso3: "USA",
        indicatorId: "cpi_core_yoy",
        periodStart: "2025-02-01",
        periodEnd: "2025-02-28",
        value: "3.4",
        sourceId: "bls-us",
        vintage: "fix",
        publishedAt: "2025-03-15T00:00:00Z",
      },
      "parsing bug in original ingest",
    );

    expect(fixed.supersedesId).toBe(bad.id);
    expect(fixed.correctionReason).toBe("parsing bug in original ingest");
  });
});
