import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool, recordObservation, recordSourcePayload } from "../src/index.js";

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
