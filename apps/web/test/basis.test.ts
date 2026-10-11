import type { CoxRequest } from "@eox/app-api";
import { describe, expect, it } from "vitest";
import { costBasis, paidFor } from "../src/lib/basis";

const UNIT = 10n ** 18n;
let next = 0;

function request(operation: CoxRequest["operation"], sequence: number, fields: Partial<CoxRequest>, minted: bigint, proceeds: bigint, state: CoxRequest["state"] = "filled"): CoxRequest {
  next += 1;
  const requestId = `request-${next}`;
  return {
    requestId,
    owner: "owner",
    operation,
    fromClass: null,
    toClass: null,
    amount: null,
    units: null,
    minimumUnits: null,
    minimumProceeds: null,
    targetBatch: sequence,
    expiryBatch: sequence + 2,
    state,
    receipt: state === "queued" ? null : { requestId, sequence, batch: sequence, status: "filled", minted: minted.toString(), proceeds: proceeds.toString() },
    ...fields,
  };
}

const swapIn = request("deposit", 38, { toClass: "CRYPTO", amount: "10000000" }, 10n * UNIT, 0n);
const buy = request("switch", 54, { fromClass: "CRYPTO", toClass: "AAVE", units: (5n * UNIT).toString() }, 5n * UNIT, 5000000n);

describe("cost basis", () => {
  it("records what a swap paid for CRYPTO", () => {
    const book = costBasis([swapIn], 6);
    expect(paidFor(book, "CRYPTO", 10)).toBe(10);
  });

  it("moves the value paid from CRYPTO to the asset on a buy, whatever order requests arrive in", () => {
    const book = costBasis([buy, swapIn], 6);
    expect(paidFor(book, "CRYPTO", 5)).toBe(5);
    expect(paidFor(book, "AAVE", 5)).toBe(5);
  });

  it("uses the value at the time of the buy, not the original collateral", () => {
    const cheaper = request("switch", 60, { fromClass: "CRYPTO", toClass: "SOL", units: (2n * UNIT).toString() }, 4n * UNIT, 2100000n);
    const book = costBasis([swapIn, cheaper], 6);
    expect(paidFor(book, "SOL", 4)).toBeCloseTo(2.1, 9);
    expect(paidFor(book, "CRYPTO", 8)).toBeCloseTo(8, 9);
  });

  it("reduces what was paid in proportion when part is sold or swapped out", () => {
    const sell = request("switch", 70, { fromClass: "AAVE", toClass: "CRYPTO", units: (2n * UNIT).toString() }, 2n * UNIT, 1990000n);
    const out = request("redeem", 71, { fromClass: "CRYPTO", units: (1n * UNIT).toString() }, 0n, 1000000n);
    const book = costBasis([swapIn, buy, sell, out], 6);
    expect(paidFor(book, "AAVE", 3)).toBeCloseTo(3, 9);
    expect(paidFor(book, "CRYPTO", 6)).toBeCloseTo((5 + 1.99) * (6 / 7), 9);
  });

  it("ignores requests that have not filled", () => {
    const queued = request("deposit", 80, { toClass: "CRYPTO", amount: "3000000" }, 0n, 0n, "queued");
    expect(paidFor(costBasis([swapIn, queued], 6), "CRYPTO", 10)).toBe(10);
  });

  it("gives no figure when the requests do not explain the units held", () => {
    const book = costBasis([swapIn], 6);
    expect(paidFor(book, "CRYPTO", 12)).toBeNull();
    expect(paidFor(book, "BTC", 1)).toBeNull();
  });
});
