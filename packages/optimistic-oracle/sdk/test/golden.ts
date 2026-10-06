import type { Hex } from "viem";

/** `resultPayload(2025)` from the adapter's `test_golden_payload`, also parsed by the program's tests. */
export const GOLDEN_PAYLOAD: Hex =
  "0x454f58520107e9" +
  "0000000000000000000000000000000000000000000000000000000000001111" +
  "0000000000000000000000000000000000000000000000000000000000002222" +
  "0000000000000000000000000000000000000000000000000000000000003333" +
  "3bd078a333c9589d2d52ae40c744d98d26f14af482521bab3fff59c26fa8d4ad" +
  "c9271b1b31a6831df4c5ff4eb51e6c4b96f63fd72cd50c99f166288821c77b18" as Hex;

export const GOLDEN_URI = "ipfs://eox-2025-snapshot";

export const word = (tail: string) => `0x${tail.padStart(64, "0")}` as const;
