export interface Asset {
  id: string;
  krakenWs: string;
  krakenRest: string;
  coinbase: string | null;
  bybit: string | null;
}

const ids = ["BTC", "ETH", "SOL", "XRP", "BNB", "TRX", "AVAX", "DOT", "NEAR", "SUI", "APT", "UNI", "ARB", "OP", "INJ", "AAVE", "ZEC", "STRK", "HYPE", "TAO", "WLD", "ONDO", "ENA", "ZRO", "FET", "JUP", "AERO", "RENDER", "TIA", "W"] as const;
const legacy: Record<string, string> = { BTC: "XXBTZUSD", ETH: "XETHZUSD", XRP: "XXRPZUSD", ZEC: "XZECZUSD" };
export const PILOT_ASSETS: readonly Asset[] = ids.map(id => Object.freeze({
  id,
  krakenWs: `${id}/USD`,
  krakenRest: legacy[id] ?? `${id}USD`,
  coinbase: id === "TRX" || id === "JUP" ? null : `${id}-USD`,
  bybit: id === "ZEC" || id === "TAO" ? null : `${id}USDT`,
}));
export type AssetId = typeof ids[number];
