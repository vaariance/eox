import { describe, expect, it } from "vitest";
import { parseScaled } from "../src/lib/amounts";
import { openBatch, planRequest } from "../src/lib/requests";

const base = { amount: "250", minimum: "", validForBatches: 3, targetBatch: 10, collateralDecimals: 6 };

describe("parseScaled", () => {
  it("converts decimal text to an exact integer", () => {
    expect(parseScaled("250", 6)).toBe(250000000n);
    expect(parseScaled("0.000001", 6)).toBe(1n);
    expect(parseScaled(" 1.5 ", 12)).toBe(1500000000000n);
  });

  it("refuses text that would need rounding or is not a plain decimal", () => {
    expect(parseScaled("0.0000001", 6)).toBeNull();
    expect(parseScaled("1e3", 6)).toBeNull();
    expect(parseScaled("-1", 6)).toBeNull();
    expect(parseScaled("01", 6)).toBeNull();
    expect(parseScaled("", 6)).toBeNull();
  });
});

describe("planRequest", () => {
  it("plans a buy in collateral base units with an inclusive expiry", () => {
    expect(planRequest({ ...base, operation: "deposit", fromClass: null, toClass: "BTC" })).toEqual({
      intent: { operation: "deposit", toClass: "BTC", amount: "250000000", minimumUnits: "0", expiryBatch: 12 },
      problem: null,
    });
  });

  it("plans a redeem in unit quanta with a minimum in collateral base units", () => {
    expect(planRequest({ ...base, operation: "redeem", fromClass: "ETH", toClass: null, amount: "1.25", minimum: "100.5", validForBatches: 1 })).toEqual({
      intent: { operation: "redeem", fromClass: "ETH", units: "1250000000000000000", minimumProceeds: "100500000", expiryBatch: 10 },
      problem: null,
    });
  });

  it("plans a switch in unit quanta", () => {
    expect(planRequest({ ...base, operation: "switch", fromClass: "ETH", toClass: "CRYPTO", amount: "2", minimum: "1" })).toEqual({
      intent: { operation: "switch", fromClass: "ETH", toClass: "CRYPTO", units: "2000000000000000000", minimumUnits: "1000000000000000000", expiryBatch: 12 },
      problem: null,
    });
  });

  it("refuses a switch into the same class, a zero amount, too many decimals and a missing batch", () => {
    expect(planRequest({ ...base, operation: "switch", fromClass: "ETH", toClass: "ETH" }).intent).toBeNull();
    expect(planRequest({ ...base, operation: "deposit", fromClass: null, toClass: "BTC", amount: "0" }).intent).toBeNull();
    expect(planRequest({ ...base, operation: "deposit", fromClass: null, toClass: "BTC", amount: "1.0000001" }).intent).toBeNull();
    expect(planRequest({ ...base, operation: "deposit", fromClass: null, toClass: "BTC", targetBatch: null }).intent).toBeNull();
    expect(planRequest({ ...base, operation: "deposit", fromClass: null, toClass: "BTC", amount: "18446744073710" }).intent).toBeNull();
  });
});

describe("openBatch", () => {
  const known = { batch: 5, cutoff: 600, acceptanceDeadline: 655 };

  it("keeps the known batch until its cutoff", () => {
    expect(openBatch(known, 0)).toEqual(known);
    expect(openBatch(known, 599)).toEqual(known);
  });

  it("moves to the first batch whose cutoff is strictly after now", () => {
    expect(openBatch(known, 600)).toEqual({ batch: 6, cutoff: 660, acceptanceDeadline: 715 });
    expect(openBatch(known, 659)).toEqual({ batch: 6, cutoff: 660, acceptanceDeadline: 715 });
    expect(openBatch(known, 720)).toEqual({ batch: 8, cutoff: 780, acceptanceDeadline: 835 });
  });
});
