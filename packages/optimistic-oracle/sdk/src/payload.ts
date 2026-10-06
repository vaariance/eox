import { type Hex, bytesToHex, concat, hexToBytes, isHex, sha256, size, stringToBytes, toHex } from "viem";

/** The hashes a result commits to. `Claim` in the adapter, `ClaimBody` in the program. */
export interface Claim {
  evidenceRoot: Hex;
  methodologyImageId: Hex;
  outputHash: Hex;
  resolutionUriHash: Hex;
}

/** A settled epoch's result, as the adapter publishes it over Wormhole. */
export interface RelayedResult {
  year: number;
  claim: Claim;
  assertionId: Hex;
}

export const PAYLOAD_MAGIC = "EOXR";
export const PAYLOAD_VERSION = 1;
export const PAYLOAD_LENGTH = 167;

function word(name: string, value: Hex): Hex {
  if (!isHex(value) || size(value) !== 32) throw new Error(`${name} must be 32 bytes of hex`);
  return value;
}

/** The SHA-256 of a resolution URI, as the adapter checks and the claim records it. */
export function resolutionUriHash(uri: string): Hex {
  return sha256(stringToBytes(uri));
}

/**
 * Encodes a result exactly as the adapter's `resultPayload`:
 * "EOXR" | version | year (big-endian u16) | evidence root | methodology image ID |
 * output hash | resolution URI hash | assertion ID.
 */
export function encodeResultPayload({ year, claim, assertionId }: RelayedResult): Hex {
  if (!Number.isInteger(year) || year < 0 || year > 0xffff) throw new Error("year must fit in a u16");
  return concat([
    toHex(PAYLOAD_MAGIC),
    toHex(PAYLOAD_VERSION, { size: 1 }),
    toHex(year, { size: 2 }),
    word("evidenceRoot", claim.evidenceRoot),
    word("methodologyImageId", claim.methodologyImageId),
    word("outputHash", claim.outputHash),
    word("resolutionUriHash", claim.resolutionUriHash),
    word("assertionId", assertionId),
  ]);
}

/** Decodes a result payload, rejecting anything that is not exactly one. */
export function decodeResultPayload(payload: Hex | Uint8Array): RelayedResult {
  const bytes = typeof payload === "string" ? hexToBytes(payload) : payload;
  if (bytes.length !== PAYLOAD_LENGTH) throw new Error(`payload must be ${PAYLOAD_LENGTH} bytes, got ${bytes.length}`);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== PAYLOAD_MAGIC) throw new Error("not an EOX result payload");
  if (bytes[4] !== PAYLOAD_VERSION) throw new Error(`unsupported payload version ${bytes[4]}`);
  const at = (offset: number) => bytesToHex(bytes.subarray(offset, offset + 32));
  return {
    year: (bytes[5] << 8) | bytes[6],
    claim: {
      evidenceRoot: at(7),
      methodologyImageId: at(39),
      outputHash: at(71),
      resolutionUriHash: at(103),
    },
    assertionId: at(135),
  };
}
