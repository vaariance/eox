import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { type Hex, bytesToHex } from "viem";
import { describe, expect, it } from "vitest";

import { snapshotEvidence } from "../src/claims.js";

interface Vector {
  name: string;
  input: { evidence_assertions?: number[][] };
  encodedHex: string;
}

const vectors: Vector[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../packages/oracle/fixtures/protocol-v1.json", import.meta.url)), "utf8"),
).vectors;
const vector = (name: string) => vectors.find((v) => v.name === name)!;
const encoded = (name: string) => `0x${vector(name).encodedHex}` as Hex;

describe("snapshotEvidence", () => {
  it.each(["snapshot-initial", "snapshot-reused-evidence"])("reads the evidence assertions of %s", (name) => {
    const expected = vector(name).input.evidence_assertions!.map((id) => bytesToHex(Uint8Array.from(id)));
    expect(snapshotEvidence(encoded(name))).toEqual(expected);
  });

  it("rejects bytes that are not a whole snapshot claim", () => {
    const claim = encoded("snapshot-initial");
    expect(() => snapshotEvidence(`${claim}00`)).toThrow("InvalidSnapshotClaim");
    expect(() => snapshotEvidence(claim.slice(0, -2) as Hex)).toThrow("InvalidSnapshotClaim");
    expect(() => snapshotEvidence(encoded("evidence"))).toThrow("InvalidSnapshotClaim");
  });
});
