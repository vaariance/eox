import { describe, expect, it } from "vitest";
import { feeLabel, quotedFee } from "./view";

const terms = { version: "1", bps: 2, cap: "2000000" };

describe("fee display", () => {
  it("shows a quoted fee in collateral with its rate", () => {
    expect(quotedFee("200", terms, 6)).toBe("0.0002 USDC (0.02%)");
    expect(quotedFee("50000", terms, 6)).toBe("0.05 USDC (0.02%)");
    expect(quotedFee("2000000", terms, 6)).toBe("2.00 USDC (0.02%)");
  });

  it("describes the terms when there is no quote", () => {
    expect(feeLabel(terms, 6)).toBe("0.02%, at most 2 USDC");
    expect(feeLabel(null, 6)).toBe("0");
  });
});
