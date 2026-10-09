export const LIVENESS_SECONDS = 72 * 3600;
export const ASSERTION_WINDOW_SECONDS = 21 * 86_400;
export const RESULT_DEADLINE_SECONDS = 35 * 86_400;

export const WORMHOLE_CHAIN = {
  solana: 1,
  base: 30,
  baseSepolia: 10004,
} as const;

export const WORMHOLE_CORE_BRIDGE_SOLANA = {
  mainnet: "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth",
  testnet: "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5",
} as const;

export function cutoffTimestamp(year: number): number {
  return Date.UTC(year + 1, 6, 31) / 1000;
}
