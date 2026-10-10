import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, recordSourcePayload } from "../src/index.js";

let observationId: string;
let payloadSha: string;

beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO observations (country_iso3, indicator_id, period_start, period_end, value, source_id, vintage)
     VALUES ('NGA', 'gdp_real_growth_yoy', '2025-01-01', '2025-03-31', 3.2, 'nbs-ng', 'archive-test') RETURNING id::text`,
  );
  observationId = rows[0].id;
  payloadSha = (await recordSourcePayload({ sourceId: "kraken", requestUrl: "GET test", httpStatus: 200, contentType: null, body: new TextEncoder().encode("archive-test") })).sha256;
});

afterAll(async () => {
  await pool.end();
});

describe("the EOX archive and the payload store stay append-only", () => {
  it("blocks UPDATE, DELETE and TRUNCATE on archived observations", async () => {
    await expect(pool.query("UPDATE observations SET value = 5 WHERE id = $1", [observationId])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM observations WHERE id = $1", [observationId])).rejects.toThrow(/append-only/);
    await expect(pool.query("TRUNCATE observations")).rejects.toThrow(/append-only/);
  });

  it("blocks UPDATE, DELETE and TRUNCATE on source payloads and source releases", async () => {
    await expect(pool.query("UPDATE source_payloads SET http_status = 500 WHERE sha256 = $1", [payloadSha])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM source_payloads WHERE sha256 = $1", [payloadSha])).rejects.toThrow(/append-only/);
    await expect(pool.query("TRUNCATE source_payloads")).rejects.toThrow(/append-only|referenced in a foreign key/);
    await expect(pool.query("TRUNCATE source_releases")).rejects.toThrow(/append-only|referenced in a foreign key/);
  });

  it("rejects a payload whose bytes do not match its digest", async () => {
    await expect(
      pool.query(`INSERT INTO source_payloads (sha256, source_id, request_url, http_status, body) VALUES ($1, 'kraken', 'x', 200, 'y')`, ["0".repeat(64)]),
    ).rejects.toThrow();
  });
});
