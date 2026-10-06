import { describe, expect, it } from "vitest";
import { cutoffTimestamp } from "../src/index.js";

describe("cutoffTimestamp", () => {
  it("matches the adapter and the program", () => {
    expect(cutoffTimestamp(2025)).toBe(1_785_456_000);
    expect(cutoffTimestamp(1969)).toBe(18_230_400);
    expect(cutoffTimestamp(2027) - cutoffTimestamp(2026)).toBe(366 * 86_400);
  });
});
