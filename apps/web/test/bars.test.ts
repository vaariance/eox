import { describe, expect, it } from "vitest";
import { barsOf } from "../src/lib/bars";

const START = 1791720000;
const points = [100, 101, 99, 102, 103, 98, 97].map((value, index) => ({ cutoff: START + 60 * (index + 1), value }));

describe("candle bars", () => {
  it("opens each one-minute bar at the previous close", () => {
    const bars = barsOf(points, 1);
    expect(bars).toHaveLength(7);
    expect(bars[0]).toMatchObject({ open: 100, high: 100, low: 100, close: 100 });
    expect(bars[1]).toMatchObject({ open: 100, high: 101, low: 100, close: 101 });
    expect(bars[2]).toMatchObject({ open: 101, high: 101, low: 99, close: 99 });
  });

  it("groups minutes into wider bars with the high and low of the group", () => {
    const bars = barsOf(points, 5);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ open: 100, high: 103, low: 99, close: 103, cutoff: START + 300 });
    expect(bars[1]).toMatchObject({ open: 103, high: 103, low: 97, close: 97 });
  });

  it("returns nothing for no points", () => {
    expect(barsOf([], 5)).toEqual([]);
  });
});
