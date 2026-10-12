import { describe, expect, it } from "vitest";
import { feeIncluded } from "./view";

describe("fee display", () => {
  it("shows a quoted fee in collateral", () => {
    expect(feeIncluded("200", 6)).toBe("0.0002 USDC fee included");
    expect(feeIncluded("50000", 6)).toBe("0.05 USDC fee included");
    expect(feeIncluded("2000000", 6)).toBe("2.00 USDC fee included");
  });
});
