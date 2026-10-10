import { describe, expect, it } from "vitest";
import { listingChanges, type Listing } from "../src/index.js";

const listing = (overrides: Partial<Listing>): Listing => ({ venue: "kraken", symbol: "TRXUSD", listed: true, status: "online", precision: "6", ...overrides });

describe("listing watch", () => {
  it("reports delisting, an unhealthy status and a precision change, and nothing for a steady listing", () => {
    expect(listingChanges(null, [listing({})])).toEqual([]);
    expect(listingChanges([listing({})], [listing({})])).toEqual([]);
    expect(listingChanges([listing({})], [listing({ listed: false, status: null, precision: null })])).toEqual(["kraken:TRXUSD is no longer listed"]);
    expect(listingChanges([listing({})], [listing({ status: "cancel_only" })])).toEqual(["kraken:TRXUSD status is cancel_only"]);
    expect(listingChanges([listing({})], [listing({ precision: "5" })])).toEqual(["kraken:TRXUSD price precision changed from 6 to 5"]);
    expect(listingChanges(null, [listing({ venue: "bybit", symbol: "TRXUSDT", status: "Trading", precision: "0.0001" })])).toEqual([]);
  });
});
