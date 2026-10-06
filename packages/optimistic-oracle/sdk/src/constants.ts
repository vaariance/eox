/** Seconds UMA gives anyone to dispute an assertion. Matches `LIVENESS` in the adapter. */
export const LIVENESS_SECONDS = 72 * 3600;
/** Seconds after the cutoff the adapter accepts assertions. Matches `ASSERTION_WINDOW`. */
export const ASSERTION_WINDOW_SECONDS = 21 * 86_400;
/** Seconds after the cutoff the Solana program accepts a result. Matches `RESULT_DEADLINE`. */
export const RESULT_DEADLINE_SECONDS = 35 * 86_400;

export const WORMHOLE_CHAIN = {
  solana: 1,
  base: 30,
  baseSepolia: 10004,
} as const;

/** Wormhole core bridge programs on Solana. Wormhole's "testnet" runs on Solana devnet. */
export const WORMHOLE_CORE_BRIDGE_SOLANA = {
  mainnet: "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth",
  testnet: "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5",
} as const;

/**
 * The evidence cutoff for epoch `year`: 31 July of the following year, 00:00 UTC, in Unix
 * seconds. Matches `cutoff_timestamp` in the Solana program and `cutoffTimestamp` in the adapter.
 */
export function cutoffTimestamp(year: number): number {
  return Date.UTC(year + 1, 6, 31) / 1000;
}
