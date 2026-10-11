import type { CoxRequest } from "@eox/app-api";
import { describe, expect, it } from "vitest";
import { tradesOf } from "../src/lib/trades";

const UNIT = 10n ** 18n;

function request(requestId: string, operation: CoxRequest["operation"], sequence: number, fields: Partial<CoxRequest>, minted: bigint, proceeds: bigint): CoxRequest {
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
    state: "filled",
    receipt: { requestId, sequence, batch: sequence, status: "filled", minted: minted.toString(), proceeds: proceeds.toString() },
    ...fields,
  };
}

const swapIn = request("a", "deposit", 38, { toClass: "CRYPTO", amount: "10000000" }, 10n * UNIT, 0n);
const buy = request("b", "switch", 96, { fromClass: "CRYPTO", toClass: "AVAX", units: UNIT.toString() }, 1002500000000000000n, 1000000n);
const sell = request("c", "switch", 120, { fromClass: "AVAX", toClass: "CRYPTO", units: (UNIT / 2n).toString() }, UNIT / 2n, 510000n);
const cash = request("d", "redeem", 130, { fromClass: "AVAX", units: (UNIT / 4n).toString() }, 0n, 260000n);

describe("trades for one position", () => {
  it("prices a buy at the value moved divided by the units received", () => {
    const [trade] = tradesOf([swapIn, buy], "AVAX", 6);
    expect(trade.side).toBe("bought");
    expect(trade.units).toBeCloseTo(1.0025, 9);
    expect(trade.value).toBe(1);
    expect(trade.price).toBeCloseTo(1 / 1.0025, 9);
  });

  it("prices a sale and a cash out at the value received per unit given, newest first", () => {
    const trades = tradesOf([swapIn, buy, sell, cash], "AVAX", 6);
    expect(trades.map((trade) => trade.side)).toEqual(["cashed out", "sold", "bought"]);
    expect(trades[0].price).toBeCloseTo(1.04, 9);
    expect(trades[1].price).toBeCloseTo(1.02, 9);
  });

  it("shows the other side of a switch for the class that was paid with", () => {
    const trades = tradesOf([swapIn, buy], "CRYPTO", 6);
    expect(trades.map((trade) => [trade.side, trade.value])).toEqual([["sold", 1], ["bought", 10]]);
  });

  it("leaves out requests that have not filled", () => {
    expect(tradesOf([{ ...buy, state: "queued", receipt: null }], "AVAX", 6)).toEqual([]);
  });
});
