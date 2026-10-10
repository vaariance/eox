import { createHash } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runChecks, sourceSupportCheck } from "../src/checks.js";
import type { EvidenceClaim } from "../src/claims.js";
import { type EvidenceSource, EvidenceUnavailable, httpEvidenceSource } from "../src/evidence-source.js";

const digest = (tag: string) => tag.repeat(32);
const claim = (artifacts: string[], recordId = "eox:observation:1"): EvidenceClaim => ({
  evidenceDigest: `0x${digest("01")}`,
  metadataDigest: `0x${digest("02")}`,
  recordId,
  artifactDigests: artifacts.map((artifact) => `0x${artifact}` as Hex),
  assessmentDigest: `0x${digest("03")}`,
  provenanceDigests: [`0x${digest("04")}`],
});

function source(overrides: Partial<EvidenceSource> = {}): EvidenceSource {
  return {
    record: async (recordId) => (recordId === "eox:observation:1" ? { recordId, artifactDigest: digest("aa") } : null),
    hasArtifact: async (sha256) => sha256 === digest("aa") || sha256 === digest("bb"),
    ...overrides,
  };
}

describe("sourceSupportCheck", () => {
  it("accepts a claim that commits the record's artifact and only available artifacts", async () => {
    expect(await sourceSupportCheck(source())(claim([digest("aa"), digest("bb")]))).toEqual({ outcome: "valid" });
  });

  it("finds a claim for a record the store does not serve invalid", async () => {
    const verdict = await sourceSupportCheck(source())(claim([digest("aa")], "eox:observation:404"));
    expect(verdict).toMatchObject({ outcome: "invalid" });
  });

  it("finds a claim that omits the record's own artifact invalid", async () => {
    expect(await sourceSupportCheck(source())(claim([digest("bb")]))).toMatchObject({ outcome: "invalid" });
  });

  it("finds a claim that commits an artifact nobody can fetch invalid", async () => {
    expect(await sourceSupportCheck(source())(claim([digest("aa"), digest("cc")]))).toMatchObject({ outcome: "invalid" });
  });

  it("never calls an unreachable store a wrong claim", async () => {
    const down = source({
      record: async () => {
        throw new EvidenceUnavailable("connection refused");
      },
    });
    expect(await sourceSupportCheck(down)(claim([digest("aa")]))).toEqual({ outcome: "unverified", reason: "connection refused" });
  });
});

describe("runChecks", () => {
  const valid = async () => ({ outcome: "valid" }) as const;
  const unverified = async () => ({ outcome: "unverified", reason: "later" }) as const;
  const invalid = async () => ({ outcome: "invalid", reason: "wrong" }) as const;

  it("is valid only when every check is valid", async () => {
    expect(await runChecks([valid, valid], claim([]))).toEqual({ outcome: "valid" });
    expect(await runChecks([valid, unverified], claim([]))).toEqual({ outcome: "unverified", reason: "later" });
    expect(await runChecks([unverified, invalid], claim([]))).toEqual({ outcome: "invalid", reason: "wrong" });
  });
});

describe("httpEvidenceSource", () => {
  const body = Buffer.from("raw source response");
  const sha = createHash("sha256").update(body).digest("hex");
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
      if (req.url === "/v1/records/eox%3Aobservation%3A1") return json(200, { recordId: "eox:observation:1", artifactDigest: sha, value: "1" });
      if (req.url === "/v1/records/eox%3Aobservation%3A2") return json(200, { recordId: "eox:observation:9", artifactDigest: sha });
      if (req.url === "/v1/records/eox%3Aobservation%3A3") return json(500, { error: "boom" });
      if (req.url === `/v1/artifacts/${sha}`) return res.writeHead(200).end(body);
      if (req.url === `/v1/artifacts/${digest("ee")}`) return res.writeHead(200).end("other bytes");
      return json(404, { error: "not found" });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  afterAll(() => {
    server.close();
  });

  it("reads a fact and reports a missing one as absent", async () => {
    const evidence = httpEvidenceSource(base);
    expect(await evidence.record("eox:observation:1")).toEqual({ recordId: "eox:observation:1", artifactDigest: sha });
    expect(await evidence.record("eox:observation:404")).toBeNull();
  });

  it("verifies artifact bytes against their digest", async () => {
    const evidence = httpEvidenceSource(base);
    expect(await evidence.hasArtifact(sha)).toBe(true);
    expect(await evidence.hasArtifact(digest("dd"))).toBe(false);
    await expect(evidence.hasArtifact(digest("ee"))).rejects.toBeInstanceOf(EvidenceUnavailable);
  });

  it("treats errors, malformed facts and an unreachable API as unavailable", async () => {
    const evidence = httpEvidenceSource(base);
    await expect(evidence.record("eox:observation:2")).rejects.toBeInstanceOf(EvidenceUnavailable);
    await expect(evidence.record("eox:observation:3")).rejects.toBeInstanceOf(EvidenceUnavailable);
    await expect(httpEvidenceSource("http://127.0.0.1:1").record("eox:observation:1")).rejects.toBeInstanceOf(EvidenceUnavailable);
  });
});
