export const COLLATERAL = { symbol: "tUSDC", name: "test USDC" };

export const SWAP_CHARGE_BPS: number | null = null;

export const NETWORKS = [
  { id: "devnet", label: "Devnet", live: true },
  { id: "mainnet", label: "Mainnet", live: false },
] as const;

export const DEFAULT_API_URL = "https://cox-app-api-529206295845.us-central1.run.app";
export const FIXTURE_DEMO_WALLET = "HgC4Jn7XMLzNsDjVdsr1x7BDuGBb2SBvx5TFLSUYaEyU";

export const CIRCLE_DEVNET_USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const CIRCLE_FAUCET_URL = "https://faucet.circle.com";
export const SOL_FAUCET_URL = "https://faucet.solana.com";
