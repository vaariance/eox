import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { pool, recordSourcePayload } from "@eox/evidence-store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEvidenceServer } from "../src/server.js";

const server = createEvidenceServer((error) => {
  throw error;
});
let baseUrl = "";
let payloadSha = "";
const get = (path: string, init?: RequestInit) => fetch(`${baseUrl}${path}`, init);

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  payloadSha = (
    await recordSourcePayload({
      sourceId: "kraken",
      requestUrl: "GET https://api.kraken.com/0/public/OHLC?pair=XXBTZUSD&interval=1",
      httpStatus: 200,
      contentType: "application/json",
      body: new TextEncoder().encode('{"error":[],"result":{"XXBTZUSD":[],"last":1791660720}}'),
    })
  ).sha256;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("GET /v1/artifacts/:sha256", () => {
  it("returns the exact stored bytes with their digest", async () => {
    const res = await get(`/v1/artifacts/${payloadSha}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-sha256")).toBe(payloadSha);
    expect(res.headers.get("x-source-content-type")).toBe("application/json");
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
  it("is read-only, answers health checks and no longer serves the EOX routes", async () => {
    expect((await get("/v1/prices/changes", { method: "POST" })).status).toBe(405);
    expect((await get("/health")).status).toBe(200);
    for (const path of ["/v1/unknown", "/v1/changes", "/v1/records/eox:observation:1", "/v1/records/eox:observation:1/constituents"]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });
});
