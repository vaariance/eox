import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, recordObservation } from "../src/index.js";

let observationId: string;

beforeAll(async () => {
  const row = await recordObservation({
    countryIso3: "NGA",
    indicatorId: "gdp_real_growth_yoy",
    periodStart: "2025-01-01",
    periodEnd: "2025-03-31",
    value: "3.2",
    sourceId: "nbs-ng",
    vintage: "first",
    publishedAt: "2025-05-30T10:00:00Z",
  });
  observationId = row.id;
});

afterAll(async () => {
  await pool.end();
});

describe("append-only enforcement", () => {
  it("blocks UPDATE", async () => {
    await expect(
      pool.query("UPDATE observations SET value = 5 WHERE id = $1", [observationId]),
    ).rejects.toThrow(/append-only/);
  });

  it("blocks DELETE", async () => {
    await expect(
      pool.query("DELETE FROM observations WHERE id = $1", [observationId]),
    ).rejects.toThrow(/append-only/);
  });

  it("blocks TRUNCATE", async () => {
    await expect(pool.query("TRUNCATE observations")).rejects.toThrow(/append-only/);
  });

  it("rejects a correction with no reason at the database level", async () => {
    await expect(
      pool.query(
        `INSERT INTO observations (country_iso3, indicator_id, period_start, period_end, value, source_id, vintage, published_at, supersedes_id)
         VALUES ('NGA','gdp_real_growth_yoy','2025-01-01','2025-03-31',3.0,'nbs-ng','fix','2025-05-30', $1)`,
        [observationId],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("rejects a malformed country code", async () => {
    await expect(
      pool.query(
        `INSERT INTO observations (country_iso3, indicator_id, period_start, period_end, value, source_id, vintage, published_at)
         VALUES ('ng','gdp_real_growth_yoy','2025-01-01','2025-03-31',3.0,'nbs-ng','first','2025-05-30')`,
      ),
    ).rejects.toThrow(/violates check constraint/);
  });
});
