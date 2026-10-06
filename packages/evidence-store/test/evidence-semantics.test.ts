import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getVersions, pool, recordObservation, recordSourcePayload } from "../src/index.js";

afterAll(async () => {
  await pool.end();
});

const base = {
  countryIso3: "USA",
  indicatorId: "unemployment_rate",
  periodStart: "2025-01-01",
  periodEnd: "2025-01-31",
  value: "4.1",
  sourceId: "oecd",
  vintage: "semantics-test",
};

describe("recorded_at", () => {
  it("is stamped by the database and cannot be supplied by the caller", async () => {
    const { rows } = await pool.query(
      `INSERT INTO observations (country_iso3, indicator_id, period_start, period_end, value, source_id, vintage, recorded_at)
       VALUES ('USA','unemployment_rate','2025-02-01','2025-02-28',4.0,'oecd','backdate-attempt','2000-01-01')
       RETURNING recorded_at, now() AS db_now`,
    );
    expect(rows[0].recorded_at.getTime()).toBe(rows[0].db_now.getTime());
  });

  it("is independent of a backdated known_at", async () => {
    const before = Date.now();
    const row = await recordObservation({ ...base, knownAt: "2001-01-01T00:00:00Z" });
    expect(row.knownAt.toISOString()).toBe("2001-01-01T00:00:00.000Z");
    expect(row.recordedAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
  });
});

describe("evidence fields", () => {
  it("stores the raw source value and leaves an unknown publication time empty", async () => {
    const row = await recordObservation({ ...base, periodStart: "2025-03-01", periodEnd: "2025-03-31", value: "2.1234565", rawValue: "2.1234565" });
    expect(row.value).toBe("2.123457");
    expect(row.rawValue).toBe("2.1234565");
    expect(row.publishedAt).toBeNull();
  });

  it("requires coverage counts to be consistent", async () => {
    const row = await recordObservation({ ...base, periodStart: "2025-04-01", periodEnd: "2025-04-30", coverageReported: 8, coverageTotal: 10 });
    expect(row.coverageReported).toBe(8);
    expect(row.coverageTotal).toBe(10);

    await expect(
      recordObservation({ ...base, periodStart: "2025-05-01", periodEnd: "2025-05-31", coverageReported: 11, coverageTotal: 10 }),
    ).rejects.toThrow(/observations_coverage_check/);
    await expect(
      recordObservation({ ...base, periodStart: "2025-06-01", periodEnd: "2025-06-30", coverageReported: 0, coverageTotal: 10 }),
    ).rejects.toThrow(/observations_coverage_check/);
  });

  it("rejects a coverage pair with only one count", async () => {
    await expect(
      recordObservation({ ...base, periodStart: "2025-09-01", periodEnd: "2025-09-30", coverageTotal: 10 }),
    ).rejects.toThrow(/observations_coverage_check/);
    await expect(
      recordObservation({ ...base, periodStart: "2025-10-01", periodEnd: "2025-10-31", coverageReported: 4 }),
    ).rejects.toThrow(/observations_coverage_check/);
  });

  it("rejects a raw hash that does not reference a stored payload", async () => {
    await expect(
      recordObservation({ ...base, periodStart: "2025-07-01", periodEnd: "2025-07-31", rawSha256: "f".repeat(64) }),
    ).rejects.toThrow(/observations_raw_payload_fk/);
  });
});

describe("source payloads", () => {
  const body = new TextEncoder().encode("REF_AREA,TIME_PERIOD,OBS_VALUE\nUS,2025-01,4.1\n");
  const sha256 = createHash("sha256").update(body).digest("hex");

  it("hashes the exact bytes and links observations to them", async () => {
    const payload = await recordSourcePayload({
      sourceId: "oecd",
      requestUrl: "https://example.test/data",
      httpStatus: 200,
      contentType: "text/csv",
      body,
    });
    expect(payload.sha256).toBe(sha256);

    const row = await recordObservation({ ...base, periodStart: "2025-08-01", periodEnd: "2025-08-31", rawSha256: payload.sha256 });
    expect(row.rawSha256).toBe(sha256);

    const { rows } = await pool.query("SELECT body FROM source_payloads WHERE sha256 = $1", [sha256]);
    expect(Buffer.compare(rows[0].body, Buffer.from(body))).toBe(0);
  });

  it("returns the original record when the same bytes are stored again", async () => {
    const first = await recordSourcePayload({ sourceId: "oecd", requestUrl: "https://example.test/data", httpStatus: 200, contentType: "text/csv", body });
    const second = await recordSourcePayload({ sourceId: "oecd", requestUrl: "https://example.test/other", httpStatus: 200, contentType: "text/csv", body });
    expect(second.recordedAt.getTime()).toBe(first.recordedAt.getTime());
    expect(second.requestUrl).toBe(first.requestUrl);
  });

  it("returns the stored record when a concurrent run commits the same payload first", async () => {
    const racing = new TextEncoder().encode(`race-${Date.now()}-${Math.random()}`);
    const expected = createHash("sha256").update(racing).digest("hex");
    const competitor = await pool.connect();
    try {
      await competitor.query("BEGIN");
      await competitor.query(
        `INSERT INTO source_payloads (sha256, source_id, request_url, http_status, body)
         VALUES ($1, 'oecd', 'https://example.test/race/first', 200, $2)`,
        [expected, Buffer.from(racing)],
      );
      const pending = recordSourcePayload({
        sourceId: "oecd",
        requestUrl: "https://example.test/race/second",
        httpStatus: 200,
        contentType: "text/plain",
        body: racing,
      });
      for (;;) {
        const { rows } = await pool.query(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE '%INSERT INTO source_payloads%' AND pid <> pg_backend_pid()`,
        );
        if (rows[0].waiting > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await competitor.query("COMMIT");
      const result = await pending;
      expect(result?.sha256).toBe(expected);
      expect(result.requestUrl).toBe("https://example.test/race/first");
    } finally {
      competitor.release();
    }
  });

  it("rejects a hash that does not match the body", async () => {
    await expect(
      pool.query(
        `INSERT INTO source_payloads (sha256, source_id, request_url, http_status, body)
         VALUES ($1, 'oecd', 'https://example.test', 200, 'tampered')`,
        [sha256],
      ),
    ).rejects.toThrow();
  });

  it("is append-only", async () => {
    await expect(pool.query("UPDATE source_payloads SET request_url = 'x' WHERE sha256 = $1", [sha256])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM source_payloads WHERE sha256 = $1", [sha256])).rejects.toThrow(/append-only/);
    await expect(pool.query("TRUNCATE source_payloads CASCADE")).rejects.toThrow(/append-only/);
  });
});

describe("getVersions", () => {
  it("returns every version for every period, ordered by period then known_at", async () => {
    const q = { countryIso3: "CAN", indicatorId: "policy_rate", sourceId: "bis" };
    const versions = [
      { periodStart: "2025-02-01", periodEnd: "2025-02-28", value: "2.75", knownAt: "2025-03-01T00:00:00Z" },
      { periodStart: "2025-01-01", periodEnd: "2025-01-31", value: "3.00", knownAt: "2025-02-15T00:00:00Z" },
      { periodStart: "2025-01-01", periodEnd: "2025-01-31", value: "3.25", knownAt: "2025-02-01T00:00:00Z" },
    ];
    for (const version of versions) {
      await recordObservation({ ...q, ...version, vintage: "versions-test" });
    }
    const stored = await getVersions(q);
    expect(stored.map((row) => `${row.periodStart} ${row.value}`)).toEqual([
      "2025-01-01 3.250000",
      "2025-01-01 3.000000",
      "2025-02-01 2.750000",
    ]);
  });
});
