import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type Hex, bytesToHex } from "viem";
import { describe, expect, it } from "vitest";

import { decodeEvidenceClaim, snapshotEvidence } from "../src/claims.js";

interface Vector {
  name: string;
  input: Record<string, unknown> & { evidence_assertions?: number[][] };
  encodedHex: string;
}

const vectors: Vector[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../packages/oracle/fixtures/protocol-v1.json", import.meta.url)), "utf8"),
).vectors;
const vector = (name: string) => vectors.find((v) => v.name === name)!;
const encoded = (name: string) => `0x${vector(name).encodedHex}` as Hex;
const hex = (value: unknown) => bytesToHex(Uint8Array.from(value as number[]));

describe("snapshotEvidence", () => {
  it.each(["snapshot-initial", "snapshot-reused-evidence"])("reads the evidence assertions of %s", (name) => {
    expect(snapshotEvidence(encoded(name))).toEqual(vector(name).input.evidence_assertions!.map(hex));
  });

  it("rejects bytes that are not a whole snapshot claim", () => {
    const claim = encoded("snapshot-initial");
    expect(() => snapshotEvidence(`${claim}00`)).toThrow("InvalidSnapshotClaim");
    expect(() => snapshotEvidence(claim.slice(0, -2) as Hex)).toThrow("InvalidSnapshotClaim");
    expect(() => snapshotEvidence(encoded("evidence"))).toThrow("InvalidSnapshotClaim");
  });
});

describe("decodeEvidenceClaim", () => {
  it("reads the shared evidence vector", () => {
    const { input } = vector("evidence");
    expect(decodeEvidenceClaim(encoded("evidence"))).toEqual({
      evidenceDigest: hex(input.evidence_digest),
      metadataDigest: hex(input.metadata_digest),
      recordId: input.record_id,
      artifactDigests: (input.artifact_digests as number[][]).map(hex),
      assessmentDigest: hex(input.assessment_digest),
      provenanceDigests: (input.provenance_digests as number[][]).map(hex),
    });
  });

  it("rejects bytes that are not a whole evidence claim", () => {
    const claim = encoded("evidence");
    expect(() => decodeEvidenceClaim(`${claim}00`)).toThrow("InvalidEvidenceClaim");
    expect(() => decodeEvidenceClaim(claim.slice(0, -2) as Hex)).toThrow("InvalidEvidenceClaim");
  });
});
