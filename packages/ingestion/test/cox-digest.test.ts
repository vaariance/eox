import { describe, expect, it } from "vitest";
import { priceBytes, priceDigest, snapshotBytes, snapshotDigest, type DigestedPrice } from "../src/cox/digest.js";

const BTC: DigestedPrice = { assetId: "BTC", venue: "kraken", step: 1, candleStart: 1791599940, priceE8: "10000000000", tradeAgeMinutes: 0 };
const ETH: DigestedPrice = { assetId: "ETH", venue: "kraken", step: 4, candleStart: 1791599880, priceE8: "20000000000", tradeAgeMinutes: 1 };

describe("COX/WIRE/V1 digests match the P1 vectors in packages/cox/fixtures/vectors.json", () => {
  it("encodes prices byte for byte", () => {
    expect(priceBytes(BTC).toString("hex")).toBe("0c000000434f582f50524943452f563103000000425443000144a5c96a0000000000e40b54020000000000");
    expect(priceDigest(BTC).toString("hex")).toBe("dbc0176eedd3138d9563dfe4e0e0d38f8cacd8ed1e1f05fe27eefad9cb785d66");
    expect(priceBytes(ETH).toString("hex")).toBe("0c000000434f582f50524943452f563103000000455448000408a5c96a0000000000c817a8040000000100");
    expect(priceDigest(ETH).toString("hex")).toBe("ebb3b87222a14272c80d264d59712f326575c2472b63ee2b4f68f03c63dc4c7e");
  });

  it("encodes the snapshot byte for byte", () => {
    expect(snapshotBytes(1791600000, [BTC, ETH]).toString("hex")).toBe(
      "0f000000434f582f534e415053484f542f563180a5c96a0000000002000000dbc0176eedd3138d9563dfe4e0e0d38f8cacd8ed1e1f05fe27eefad9cb785d66ebb3b87222a14272c80d264d59712f326575c2472b63ee2b4f68f03c63dc4c7e",
    );
    expect(snapshotDigest(1791600000, [BTC, ETH])).toBe("88a2d25a94f3a4c50f8a269e19a9aaa401584ffedab0acc7ce676efedeb11eaa");
  });

  it("refuses what the wire format cannot carry", () => {
    expect(() => priceBytes({ ...BTC, priceE8: "0" })).toThrow(/InvalidPrice/);
    expect(() => priceBytes({ ...BTC, venue: "coinbase" })).toThrow(/InvalidVenueStep/);
    expect(() => priceBytes({ ...ETH, tradeAgeMinutes: 31, candleStart: 1791600000 - 60 - 31 * 60 })).toThrow(/InvalidPrice/);
    expect(() => priceBytes({ ...BTC, tradeAgeMinutes: 2 })).toThrow(/InvalidCandle/);
    expect(() => snapshotBytes(1791600060, [BTC, ETH])).toThrow(/InvalidSnapshotOrderOrTime/);
    expect(() => snapshotBytes(1791600000, [BTC])).toThrow(/InvalidSnapshot/);
  });
});
