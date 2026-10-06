import { describe, expect, it } from "vitest";
import { decodeResultPayload, encodeResultPayload, resolutionUriHash } from "../src/index.js";
import { GOLDEN_PAYLOAD, GOLDEN_URI, word } from "./golden.js";

const golden = {
  year: 2025,
  claim: {
    evidenceRoot: word("1111"),
    methodologyImageId: word("2222"),
    outputHash: word("3333"),
    resolutionUriHash: resolutionUriHash(GOLDEN_URI),
  },
  assertionId: word("b10e2d527612073b26eecdfd717e6a320cf44b4afac2b0732d9fcbe2b7fa0cf6"),
};

describe("result payload", () => {
  it("encodes exactly the bytes the adapter publishes", () => {
    expect(encodeResultPayload(golden)).toBe(GOLDEN_PAYLOAD);
  });

  it("decodes the adapter's bytes", () => {
    expect(decodeResultPayload(GOLDEN_PAYLOAD)).toEqual(golden);
  });

  it("hashes the resolution URI the way the adapter checks it", () => {
    expect(resolutionUriHash(GOLDEN_URI)).toBe(word("3bd078a333c9589d2d52ae40c744d98d26f14af482521bab3fff59c26fa8d4ad"));
  });

  it("rejects anything that is not exactly an EOX result", () => {
    const bytes = Buffer.from(GOLDEN_PAYLOAD.slice(2), "hex");
    const variant = (edit: (b: Buffer) => Buffer) => edit(Buffer.from(bytes));
    for (const bad of [
      variant((b) => ((b[0] = 0x58), b)),
      variant((b) => ((b[4] = 2), b)),
      variant((b) => b.subarray(0, b.length - 1)),
      Buffer.concat([bytes, Buffer.from([0])]),
    ]) {
      expect(() => decodeResultPayload(new Uint8Array(bad))).toThrow();
    }
  });

  it("refuses to encode values that do not fit", () => {
    expect(() => encodeResultPayload({ ...golden, year: 70_000 })).toThrow();
    expect(() => encodeResultPayload({ ...golden, assertionId: "0x1234" })).toThrow();
  });
});
