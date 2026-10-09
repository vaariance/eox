import { describe, expect, it } from "vitest";
import { sumDecimals } from "../src/decimal.js";
import { aggregateCountry, toObservations } from "../src/indicators/container-throughput.js";
import { parsePortRecords, type CountryPortPayload } from "../src/sources/portwatch.js";

describe("sumDecimals", () => {
  it("adds exactly across different scales", () => {
    expect(sumDecimals(["0.1", "0.2"])).toBe("0.3");
    expect(sumDecimals(["1.10", "2", "0.005"])).toBe("3.105");
    expect(sumDecimals(["12345678901234567.25", "0.75"])).toBe("12345678901234568.00");
    expect(sumDecimals(["-1.5", "1"])).toBe("-0.5");
    expect(sumDecimals([])).toBe("0");
  });

  it("rejects values that are not plain decimals", () => {
    expect(() => sumDecimals(["1e3"])).toThrow(/invalid decimal/);
    expect(() => sumDecimals(["01.5"])).toThrow(/invalid decimal/);
  });
});

const response = (features: string) => `{"objectIdFieldName":"ObjectId","features":[${features}]}`;
const feature = (port: string, imports: string, exports: string) =>
  `{"attributes":{"date":"2026-09-25","ISO3":"USA","portid":"${port}","portcalls_container":3,"import_container":${imports},"export_container":${exports}}}`;

describe("parsePortRecords", () => {
  it("keeps the exact source text of every number", () => {
    const [record] = parsePortRecords(response(feature("port1", "1000.10", "0.1234567")));
    expect(record).toEqual({
      date: "2026-09-25",
      iso3: "USA",
      portId: "port1",
      portCalls: "3",
      importContainer: "1000.10",
      exportContainer: "0.1234567",
    });
  });

  it("keeps explicit nulls and rejects exponent notation", () => {
    expect(parsePortRecords(response(feature("port1", "null", "5")))[0]!.importContainer).toBeNull();
    expect(() => parsePortRecords(response(feature("port1", "1e3", "5")))).toThrow(/not a plain decimal/);
  });

  it("rejects error responses and truncated pages", () => {
    expect(() => parsePortRecords('{"error":{"code":400,"message":"bad"}}')).toThrow(/PortWatch error: bad/);
    expect(() => parsePortRecords('{"exceededTransferLimit":true,"features":[]}')).toThrow(/more than/);
  });
});

describe("aggregateCountry", () => {
  it("sums reported ports exactly and stores the normalized total", () => {
    const records = parsePortRecords(
      response([feature("port1", "0.1", "0.2"), feature("port2", "1000000.0000005", "0"), feature("port3", "null", "7")].join(",")),
    );
    const country: CountryPortPayload = {
      payload: { requestUrl: "https://example.test", httpStatus: 200, contentType: "application/json", body: new Uint8Array(), sha256: "a".repeat(64) },
      records,
    };
    const aggregate = aggregateCountry("USA", country)!;
    expect(aggregate).toMatchObject({ tonnage: "1000000.3000005", portsReported: 2, portsTotal: 3 });
    expect(toObservations("2026-09-25", [aggregate])[0]!.value).toBe("1000000.300001");
  });
});
