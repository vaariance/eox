import type { AddressInfo } from "node:net";

import type { Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AsserterError, type EvidenceRequest } from "../src/asserter.js";
import { SCHEMA_VERSION, createAssertionServer } from "../src/server.js";

const WORD = `0x${"ab".repeat(32)}` as Hex;
const receipt = { assertionId: `0x${"11".repeat(32)}` as Hex, claimDigest: `0x${"22".repeat(32)}` as Hex, created: true };

describe("assertion server", () => {
  const evidence: EvidenceRequest[] = [];
  const snapshots: Hex[] = [];
  const errors: unknown[] = [];
  const server = createAssertionServer({
    verifyCaller: async (authorization) => (authorization === "Bearer worker" ? "worker@example.iam.gserviceaccount.com" : null),
    asserter: {
      assertEvidence: async (request) => {
        if (request.claim === "0xbad0") throw new AsserterError("CLAIM_REJECTED", "WrongContext");
        if (request.claim === "0xfeed") throw new AsserterError("UNDERFUNDED", "no bond");
        if (request.claim === "0xdead") throw new Error("rpc exploded with secret details");
        evidence.push(request);
        return receipt;
      },
      assertSnapshot: async (claim) => {
        snapshots.push(claim);
        return { ...receipt, created: false };
      },
    },
    onError: (error) => errors.push(error),
  });
  let base: string;

  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: { authorization: "Bearer worker", "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("answers health checks without a token", async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("requires a registered caller", async () => {
    const response = await post("/v1/assertions/evidence", {}, { authorization: "Bearer stranger" });
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
    expect(evidence).toHaveLength(0);
  });

  it("posts evidence and returns the assertion", async () => {
    const request = { proposal: WORD, precommitment: WORD, claim: "0x0102" };
    const response = await post("/v1/assertions/evidence", request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ schemaVersion: SCHEMA_VERSION, ...receipt });
    expect(evidence).toEqual([request]);
  });

  it("posts a snapshot from its claim alone", async () => {
    const response = await post("/v1/assertions/snapshot", { claim: "0x0a0b" });
    expect(response.status).toBe(200);
    expect((await response.json()).created).toBe(false);
    expect(snapshots).toEqual(["0x0a0b"]);
  });

  it("rejects malformed requests before reaching the asserter", async () => {
    const cases: [string, unknown, Record<string, string>?][] = [
      ["/v1/assertions/evidence", { proposal: WORD, precommitment: WORD }],
      ["/v1/assertions/evidence", { proposal: "0x12", precommitment: WORD, claim: "0x01" }],
      ["/v1/assertions/evidence", { proposal: WORD, precommitment: WORD, claim: "0xABCD" }],
      ["/v1/assertions/evidence", { proposal: WORD, precommitment: WORD, claim: "0x123" }],
      ["/v1/assertions/snapshot", "not json"],
      ["/v1/assertions/snapshot", [1, 2]],
      ["/v1/assertions/snapshot", { claim: "0x01" }, { "content-type": "text/plain" }],
    ];
    for (const [path, body, headers] of cases) {
      const response = await post(path, body, headers);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    }
    expect(evidence).toHaveLength(1);
    expect(snapshots).toHaveLength(1);
  });

  it("maps asserter failures to their codes and hides internal errors", async () => {
    const send = (claim: string) => post("/v1/assertions/evidence", { proposal: WORD, precommitment: WORD, claim });

    const rejected = await send("0xbad0");
    expect(rejected.status).toBe(422);
    expect((await rejected.json()).error).toEqual({ code: "CLAIM_REJECTED", message: "WrongContext" });

    const underfunded = await send("0xfeed");
    expect(underfunded.status).toBe(503);
    expect((await underfunded.json()).error.code).toBe("UNDERFUNDED");

    const internal = await send("0xdead");
    expect(internal.status).toBe(500);
    expect((await internal.json()).error).toEqual({ code: "INTERNAL_ERROR", message: "internal error" });
    expect(errors).toHaveLength(1);
  });

  it("answers unknown routes and methods", async () => {
    expect((await post("/v1/assertions/other", { claim: "0x01" })).status).toBe(404);
    const get = await fetch(`${base}/v1/assertions/snapshot`, { headers: { authorization: "Bearer worker" } });
    expect(get.status).toBe(405);
  });

  it("refuses bodies over the size limit", async () => {
    const response = await post("/v1/assertions/snapshot", { claim: `0x${"00".repeat(1024 * 1024 + 1)}` });
    expect(response.status).toBe(413);
  });
});
