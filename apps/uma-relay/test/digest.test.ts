import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Hex } from "viem";
import { describe, expect, it } from "vitest";

import { claimDigest } from "../src/digest.js";

const vectors: { name: string; kind: string; encodedHex: string; sha256: string }[] = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../packages/oracle/fixtures/protocol-v1.json", import.meta.url)), "utf8"),
).vectors;

describe("claimDigest", () => {
  it.each(vectors.filter((vector) => vector.kind === "evidence" || vector.kind === "snapshot"))(
    "matches the shared vector $name",
    (vector) => {
      expect(claimDigest(vector.kind as "evidence" | "snapshot", `0x${vector.encodedHex}` as Hex)).toBe(`0x${vector.sha256}`);
    },
  );

  it("separates the two claim kinds", () => {
    const claim = `0x${vectors[0]!.encodedHex}` as Hex;
    expect(claimDigest("evidence", claim)).not.toBe(claimDigest("snapshot", claim));
  });
});
