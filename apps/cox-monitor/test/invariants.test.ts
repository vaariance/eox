import { describe, expect, it } from "vitest";
import { MonitorMathError, SCALE } from "../src/arithmetic.js";
import { type ClassState, type PoolRequest, executeBatch, revalue } from "../src/pool.js";
import { computeReference } from "../src/reference.js";
import { encodePrice, encodeSnapshot } from "../src/wire.js";

function generator(seed: number): () => bigint {
  let state = BigInt(seed);
  return () => {
    state = (state * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return state >> 33n;
  };
}

function code(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof MonitorMathError) return error.code;
    throw error;
  }
  return "no error";
}

const total = (classes: readonly ClassState[]) => classes.reduce((sum, state) => sum + state.backing, 0n);

describe("reference", () => {
  it("leaves every reference and transfer factor unchanged when all assets move together", () => {
    const next = generator(7);
    for (let round = 0; round < 200; round += 1) {
      const previous = [1n + next() % 10_000_000n, 1n + next() % 10_000_000n, 1n + next() % 10_000_000n];
      const factor = 1n + next() % 50n;
      const result = computeReference({
        previousPrices: previous,
        currentPrices: previous.map((price) => price * factor),
        originPrices: previous,
        previousBenchmark: 100n * SCALE,
      });
      expect(result.references).toEqual([100n * SCALE, 100n * SCALE, 100n * SCALE]);
      expect(result.transferFactors).toEqual([SCALE, SCALE, SCALE, SCALE]);
    }
  });

  it("refuses a zero or negative price", () => {
    const input = { previousPrices: [100n, 100n], currentPrices: [0n, 100n], originPrices: [100n, 100n], previousBenchmark: 100n * SCALE };
    expect(code(() => computeReference(input))).toBe("InvalidReferenceInput");
    expect(code(() => computeReference({ ...input, currentPrices: [100n, -1n] }))).toBe("InvalidReferenceInput");
  });
});

describe("reference rejection", () => {
  it("refuses a benchmark growth that rounds to zero", () => {
    const collapse = { previousPrices: [10n ** 18n, 10n ** 18n], currentPrices: [1n, 1n], originPrices: [10n ** 18n, 10n ** 18n], previousBenchmark: 100n * SCALE };
    expect(code(() => computeReference(collapse))).toBe("InvalidBenchmark");
  });
});

describe("revaluation", () => {
  it("never creates collateral and leaves less than one base unit per class in the residual", () => {
    const next = generator(11);
    for (let round = 0; round < 500; round += 1) {
      const classes = [0, 1, 2, 3].map(() => {
        const backing = next() % 1_000_000_000n;
        return { backing, units: backing === 0n ? 0n : 1n + next() % (1_000_000n * SCALE) };
      });
      const factors = classes.map(() => SCALE / 2n + next() % SCALE);
      if (total(classes) === 0n) continue;
      const result = revalue(classes, factors);
      expect(total(result.classes) + result.residual).toBe(total(classes));
      expect(result.residual >= 0n && result.residual < BigInt(classes.length)).toBe(true);
      expect(result.classes.map((state) => state.units)).toEqual(classes.map((state) => state.units));
    }
  });
});

describe("batch execution", () => {
  const classes: ClassState[] = [
    { backing: 90_000_000n, units: 100n * SCALE },
    { backing: 60_000_000n, units: 50n * SCALE },
    { backing: 0n, units: 0n },
  ];
  const requests: PoolRequest[] = [
    { id: "a", kind: "deposit", to: 0, amount: 30_000_000n, minimum: 0n, expiry: 5 },
    { id: "b", kind: "redeem", from: 1, units: 10n * SCALE, minimum: 0n, expiry: 5 },
    { id: "c", kind: "switch", from: 0, to: 1, units: 7n * SCALE, minimum: 0n, expiry: 5 },
    { id: "d", kind: "deposit", to: 2, amount: 1_234_567n, minimum: 0n, expiry: 5 },
    { id: "e", kind: "deposit", to: 1, amount: 5n, minimum: 10n * SCALE, expiry: 5 },
    { id: "f", kind: "redeem", from: 0, units: 3n * SCALE, minimum: 0n, expiry: 0 },
  ];

  it("gives the same result whatever order the requests are processed in", () => {
    const expected = executeBatch(classes, requests, 1);
    const byId = (id: string, receipts = expected.receipts) => receipts.find((receipt) => receipt.id === id);
    const next = generator(3);
    for (let round = 0; round < 50; round += 1) {
      const shuffled = [...requests].sort(() => (next() % 2n === 0n ? 1 : -1));
      const result = executeBatch(classes, shuffled, 1);
      expect(result.classes).toEqual(expected.classes);
      expect([result.payable, result.refunds, result.residual]).toEqual([expected.payable, expected.refunds, expected.residual]);
      for (const request of requests) expect(byId(request.id, result.receipts)).toEqual(byId(request.id));
    }
  });

  it("keeps the vault equal to backing, payables, refunds and residual", () => {
    const pendingDeposits = 30_000_000n + 1_234_567n + 5n;
    const vaultBefore = total(classes) + pendingDeposits;
    const result = executeBatch(classes, requests, 1);
    expect(total(result.classes) + result.payable + result.refunds + result.residual).toBe(vaultBefore);
    expect(result.residual >= 0n).toBe(true);
  });

  it("rejects without moving value when a request expired or its condition failed", () => {
    const result = executeBatch(classes, requests, 1);
    expect(result.receipts.find((receipt) => receipt.id === "e")).toEqual({ id: "e", outcome: "ConditionFailed", minted: 0n, proceeds: 0n });
    expect(result.receipts.find((receipt) => receipt.id === "f")).toEqual({ id: "f", outcome: "Expired", minted: 0n, proceeds: 0n });
    expect(result.refunds).toBe(5n);
  });

  it("refuses requests that lock more units than a class holds", () => {
    const greedy: PoolRequest[] = [
      { id: "x", kind: "redeem", from: 1, units: 30n * SCALE, minimum: 0n, expiry: 5 },
      { id: "y", kind: "switch", from: 1, to: 0, units: 21n * SCALE, minimum: 0n, expiry: 5 },
    ];
    expect(code(() => executeBatch(classes, greedy, 1))).toBe("OverReservedUnits");
  });

  it("does not accept a deposit into a class that has units but no value", () => {
    const worthless: ClassState[] = [{ backing: 0n, units: 5n * SCALE }, { backing: 10n, units: SCALE }];
    const result = executeBatch(worthless, [{ id: "z", kind: "deposit", to: 0, amount: 9n, minimum: 0n, expiry: 5 }], 1);
    expect(result.receipts[0]!.outcome).toBe("ZeroValueClass");
    expect(result.refunds).toBe(9n);
  });
});

describe("wire encoding", () => {
  const valid = { assetId: "BTC", venue: 0, step: 1, candleStart: 1791599940n, priceE8: 10_000_000_000n, tradeAgeMinutes: 0 };

  it("refuses a venue that does not belong to the fallback step", () => {
    expect(code(() => encodePrice({ ...valid, venue: 1 }))).toBe("InvalidVenueStep");
    expect(code(() => encodePrice({ ...valid, venue: 2, step: 2 }))).toBe("InvalidVenueStep");
  });

  it("refuses a trade age on a fresh candle or beyond thirty minutes", () => {
    expect(code(() => encodePrice({ ...valid, tradeAgeMinutes: 1 }))).toBe("InvalidCandle");
    expect(code(() => encodePrice({ ...valid, step: 4, tradeAgeMinutes: 31 }))).toBe("InvalidPrice");
  });

  it("refuses a snapshot whose prices are out of roster order or from the wrong minute", () => {
    const eth = { ...valid, assetId: "ETH" };
    expect(code(() => encodeSnapshot(1791600000n, ["ETH", "BTC"], [valid, eth]))).toBe("InvalidSnapshotOrderOrTime");
    expect(code(() => encodeSnapshot(1791600060n, ["BTC", "ETH"], [valid, eth]))).toBe("InvalidSnapshotOrderOrTime");
  });
});
