export const COLLATERAL = { symbol: "tUSDC", name: "test USDC" };

export const SWAP_CHARGE_BPS: number | null = null;

export const NETWORKS = [
  { id: "devnet", label: "Devnet", live: true },
  { id: "mainnet", label: "Mainnet", live: false },
] as const;
