import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { pool, recordObservation, recordSourcePayload, type NewObservation } from "@eox/evidence-store";
import { periodOrdinal, seriesIdentity } from "@eox/methodology";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEvidenceServer } from "../src/server.js";

const server = createEvidenceServer((error) => {
  throw error;
});
let baseUrl = "";
let payloadSha = "";
const payloadBody = new TextEncoder().encode("REF_AREA,TIME_PERIOD,OBS_VALUE\nUSA,2026-08,2.456557\n");
const ids: Record<string, string> = {};
let portPayloadSha = "";
const portBody =
  '{"features":[' +
  '{"attributes":{"date":"2026-09-25","ISO3":"USA","portid":"port1","portcalls_container":4,"import_container":1000.10,"export_container":44.5}},' +
  '{"attributes":{"date":"2026-09-25","ISO3":"USA","portid":"port2","portcalls_container":1,"import_container":null,"export_container":3}}]}';

async function get(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, init);
}

async function allChanges(limit: number): Promise<{ changeId: string; recordId: string }[]> {
  const collected: { changeId: string; recordId: string }[] = [];
  let cursor = "";
  for (;;) {
    const res = await get(`/v1/changes?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
    expect(res.status).toBe(200);
    const page = (await res.json()) as { cursor: string | null; changes: { changeId: string; recordId: string }[] };
    if (page.cursor === null || page.cursor === cursor) return collected;
    collected.push(...page.changes);
    cursor = page.cursor;
  }
}

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  payloadSha = (
    await recordSourcePayload({
      sourceId: "oecd",
      requestUrl: "https://example.test/cpi",
      httpStatus: 200,
      contentType: "text/csv",
      body: payloadBody,
    })
  ).sha256;

  const record = async (key: string, observation: NewObservation) => {
    ids[key] = (await recordObservation(observation)).id;
  };
  await record("cpi", {
    countryIso3: "USA",
    indicatorId: "cpi_core_yoy",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    value: "2.456557",
    rawValue: "2.456557",
    rawSha256: payloadSha,
    sourceId: "oecd",
    vintage: "retrieved-2026-10-08",
  });
  await record("unemploymentNzl", {
    countryIso3: "NZL",
    indicatorId: "unemployment_rate",
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    value: "5.6",
    rawValue: "5.6",
    rawSha256: payloadSha,
    sourceId: "oecd",
    vintage: "retrieved-2026-10-08",
  });
  portPayloadSha = (
    await recordSourcePayload({
      sourceId: "imf-portwatch",
      requestUrl: "https://example.test/ports",
      httpStatus: 200,
      contentType: "application/json",
      body: new TextEncoder().encode(portBody),
    })
  ).sha256;
  await record("container", {
    countryIso3: "USA",
    indicatorId: "container_throughput",
    periodStart: "2026-09-25",
    periodEnd: "2026-09-25",
    value: "1044413.000000",
    rawSha256: portPayloadSha,
    sourceId: "imf-portwatch",
    vintage: "daily_estimate",
    coverageReported: 118,
    coverageTotal: 118,
  });
  await record("notInCatalogue", {
    countryIso3: "NGA",
    indicatorId: "gdp_real_growth_yoy",
    periodStart: "2025-01-01",
    periodEnd: "2025-03-31",
    value: "3.2",
    sourceId: "nbs-ng",
    vintage: "first",
  });
  await record("noPayload", {
    countryIso3: "USA",
    indicatorId: "policy_rate",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    value: "3.625",
    sourceId: "bis",
    vintage: "retrieved-2026-10-08",
  });
  await record("badPeriod", {
    countryIso3: "USA",
    indicatorId: "unemployment_rate",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-30",
    value: "4.1",
    rawSha256: payloadSha,
    sourceId: "oecd",
    vintage: "retrieved-2026-10-08",
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("GET /v1/records/:recordId", () => {
  it("returns the evidence fact with catalogue identities and native period", async () => {
    const res = await get(`/v1/records/eox:observation:${ids.cpi}`);
    expect(res.status).toBe(200);
    const fact = await res.json();
    expect(fact).toMatchObject({
      recordId: `eox:observation:${ids.cpi}`,
      seriesId: seriesIdentity("USA", "cpi_core_yoy"),
      revisionId: "retrieved-2026-10-08",
      country: "US",
      countryIso3: "USA",
      indicator: "cpi_core_yoy",
      source: "oecd",
      unit: "percent",
      frequency: "monthly",
      period: "2026-08",
      periodOrdinal: periodOrdinal("monthly", "2026-08"),
      value: "2.456557",
      rawValue: "2.456557",
      publishedAt: null,
      artifactDigest: payloadSha,
      coverage: null,
      revision: { revises: null, orderBasis: "retrieval", sourceEdition: null },
      supersedes: null,
    });
    expect(Number.isInteger(fact.recordedAt)).toBe(true);
  });

  it("uses the quarterly period for New Zealand unemployment", async () => {
    const fact = await (await get(`/v1/records/eox:observation:${ids.unemploymentNzl}`)).json();
    expect(fact.frequency).toBe("quarterly");
    expect(fact.period).toBe("2026-Q2");
  });

  it("returns coverage for container throughput", async () => {
    const fact = await (await get(`/v1/records/eox:observation:${ids.container}`)).json();
    expect(fact.period).toBe("2026-09-25");
    expect(fact.coverage).toEqual({ reported: 118, total: 118 });
  });

  it("does not serve rows that are not oracle evidence", async () => {
    for (const key of ["notInCatalogue", "noPayload", "badPeriod"]) {
      expect((await get(`/v1/records/eox:observation:${ids[key]}`)).status).toBe(404);
    }
    expect((await get("/v1/records/eox:observation:999999999")).status).toBe(404);
  });

  it("rejects a malformed record id", async () => {
    for (const recordId of ["42", "eox:observation:0", "eox:observation:1;drop", "eox:observation:%E0%A4%A"]) {
      expect((await get(`/v1/records/${recordId}`)).status).toBe(400);
    }
  });
});

describe("revision provenance", () => {
  it("links a GDP edition to the edition it revises, ordered by source edition", async () => {
    const base = {
      countryIso3: "JPN",
      indicatorId: "gdp_real_volume",
      periodStart: "2025-01-01",
      periodEnd: "2025-03-31",
      rawSha256: payloadSha,
      sourceId: "oecd",
    };
    const first = await recordObservation({ ...base, value: "140263950", rawValue: "140263950000000", vintage: "oecd-edition-202506", knownAt: "2025-06-01T00:00:00Z" });
    const second = await recordObservation({
      ...base,
      value: "140385450",
      rawValue: "140385450000000",
      vintage: "oecd-edition-202507",
      knownAt: "2025-07-01T00:00:00Z",
      revisesId: first.id,
    });
    const fact = await (await get(`/v1/records/eox:observation:${second.id}`)).json();
    expect(fact.revision).toEqual({ revises: `eox:observation:${first.id}`, orderBasis: "source-edition", sourceEdition: "202507" });
    expect(fact.period).toBe("2025-Q1");
  });
});

describe("GET /v1/records/:recordId/constituents", () => {
  it("returns each port's exact source values from the stored artifact", async () => {
    const res = await get(`/v1/records/eox:observation:${ids.container}/constituents`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ country: "US", period: "2026-09-25", artifactDigest: portPayloadSha, coverage: { reported: 118, total: 118 } });
    expect(body.ports).toEqual([
      { portId: "port1", date: "2026-09-25", importContainer: "1000.10", exportContainer: "44.5", portCalls: "4", reported: true },
      { portId: "port2", date: "2026-09-25", importContainer: null, exportContainer: "3", portCalls: "1", reported: false },
    ]);
  });

  it("returns 404 for indicators without constituents", async () => {
    expect((await get(`/v1/records/eox:observation:${ids.cpi}/constituents`)).status).toBe(404);
  });
});

describe("GET /v1/changes", () => {
  it("lists every evidence record exactly once across pages and skips non-evidence rows", async () => {
    const changes = await allChanges(2);
    const recordIds = changes.map((change) => change.recordId);
    expect(new Set(recordIds).size).toBe(recordIds.length);
    const evidence = [ids.cpi, ids.unemploymentNzl, ids.container].map((id) => `eox:observation:${id}`);
    expect(recordIds.filter((id) => evidence.includes(id))).toEqual(evidence);
    for (const key of ["notInCatalogue", "noPayload", "badPeriod"]) {
      expect(recordIds).not.toContain(`eox:observation:${ids[key]}`);
    }
    expect(changes.every((change) => change.changeId === change.recordId.replace("eox:observation:", "eox:change:"))).toBe(true);
  });

  it("returns the same cursor when there is nothing new", async () => {
    const first = (await (await get("/v1/changes?limit=500")).json()) as { cursor: string };
    const second = (await (await get(`/v1/changes?cursor=${first.cursor}`)).json()) as { cursor: string; changes: [] };
    expect(second.cursor).toBe(first.cursor);
    expect(second.changes).toEqual([]);
  });

  it("rejects invalid cursors and limits", async () => {
    for (const query of ["cursor=abc", "cursor=1.0", "cursor=1.2.3", "limit=0", "limit=501", "limit=ten"]) {
      expect((await get(`/v1/changes?${query}`)).status).toBe(400);
    }
  });
});

describe("GET /v1/artifacts/:sha256", () => {
  it("returns the exact stored bytes with their digest", async () => {
    const res = await get(`/v1/artifacts/${payloadSha}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-sha256")).toBe(payloadSha);
    expect(res.headers.get("x-source-content-type")).toBe("text/csv");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(payloadSha);
  });

  it("returns 404 for an unknown digest and 400 for a malformed one", async () => {
    expect((await get(`/v1/artifacts/${"0".repeat(64)}`)).status).toBe(404);
    expect((await get("/v1/artifacts/not-a-digest")).status).toBe(400);
    expect((await get(`/v1/artifacts/${payloadSha.toUpperCase()}`)).status).toBe(400);
  });
});

describe("other requests", () => {
  it("is read-only and answers health checks", async () => {
    expect((await get("/v1/changes", { method: "POST" })).status).toBe(405);
    expect((await get("/health")).status).toBe(200);
    expect((await get("/v1/unknown")).status).toBe(404);
  });
});
