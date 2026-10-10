export interface RosterAsset {
  assetId: string;
  position: number;
  name: string;
  krakenWsSymbol: string;
  krakenRestPair: string;
  coinbaseProduct: string | null;
  bybitSymbol: string | null;
}

const ROWS: [string, string, string, string, string | null, string | null][] = [
  ["BTC", "Bitcoin", "BTC/USD", "XXBTZUSD", "BTC-USD", "BTCUSDT"],
  ["ETH", "Ethereum", "ETH/USD", "XETHZUSD", "ETH-USD", "ETHUSDT"],
  ["SOL", "Solana", "SOL/USD", "SOLUSD", "SOL-USD", "SOLUSDT"],
  ["XRP", "XRP", "XRP/USD", "XXRPZUSD", "XRP-USD", "XRPUSDT"],
  ["BNB", "BNB", "BNB/USD", "BNBUSD", "BNB-USD", "BNBUSDT"],
  ["TRX", "Tron", "TRX/USD", "TRXUSD", null, "TRXUSDT"],
  ["AVAX", "Avalanche", "AVAX/USD", "AVAXUSD", "AVAX-USD", "AVAXUSDT"],
  ["DOT", "Polkadot", "DOT/USD", "DOTUSD", "DOT-USD", "DOTUSDT"],
  ["NEAR", "NEAR Protocol", "NEAR/USD", "NEARUSD", "NEAR-USD", "NEARUSDT"],
  ["SUI", "Sui", "SUI/USD", "SUIUSD", "SUI-USD", "SUIUSDT"],
  ["APT", "Aptos", "APT/USD", "APTUSD", "APT-USD", "APTUSDT"],
  ["UNI", "Uniswap", "UNI/USD", "UNIUSD", "UNI-USD", "UNIUSDT"],
  ["ARB", "Arbitrum", "ARB/USD", "ARBUSD", "ARB-USD", "ARBUSDT"],
  ["OP", "Optimism", "OP/USD", "OPUSD", "OP-USD", "OPUSDT"],
  ["INJ", "Injective", "INJ/USD", "INJUSD", "INJ-USD", "INJUSDT"],
  ["AAVE", "Aave", "AAVE/USD", "AAVEUSD", "AAVE-USD", "AAVEUSDT"],
  ["ZEC", "Zcash", "ZEC/USD", "XZECZUSD", "ZEC-USD", null],
  ["STRK", "Starknet", "STRK/USD", "STRKUSD", "STRK-USD", "STRKUSDT"],
  ["HYPE", "Hyperliquid", "HYPE/USD", "HYPEUSD", "HYPE-USD", "HYPEUSDT"],
  ["TAO", "Bittensor", "TAO/USD", "TAOUSD", "TAO-USD", null],
  ["WLD", "Worldcoin", "WLD/USD", "WLDUSD", "WLD-USD", "WLDUSDT"],
  ["ONDO", "Ondo", "ONDO/USD", "ONDOUSD", "ONDO-USD", "ONDOUSDT"],
  ["ENA", "Ethena", "ENA/USD", "ENAUSD", "ENA-USD", "ENAUSDT"],
  ["ZRO", "LayerZero", "ZRO/USD", "ZROUSD", "ZRO-USD", "ZROUSDT"],
  ["FET", "Artificial Superintelligence Alliance", "FET/USD", "FETUSD", "FET-USD", "FETUSDT"],
  ["JUP", "Jupiter", "JUP/USD", "JUPUSD", null, "JUPUSDT"],
  ["AERO", "Aerodrome", "AERO/USD", "AEROUSD", "AERO-USD", "AEROUSDT"],
  ["RENDER", "Render", "RENDER/USD", "RENDERUSD", "RENDER-USD", "RENDERUSDT"],
  ["TIA", "Celestia", "TIA/USD", "TIAUSD", "TIA-USD", "TIAUSDT"],
  ["W", "Wormhole", "W/USD", "WUSD", "W-USD", "WUSDT"],
];

export const ROSTER: readonly RosterAsset[] = ROWS.map(([assetId, name, krakenWsSymbol, krakenRestPair, coinbaseProduct, bybitSymbol], position) => ({
  assetId,
  position,
  name,
  krakenWsSymbol,
  krakenRestPair,
  coinbaseProduct,
  bybitSymbol,
}));

export const USDT_USD = { krakenWsSymbol: "USDT/USD", krakenRestPair: "USDTZUSD", coinbaseProduct: "USDT-USD" } as const;

export function rosterAsset(assetId: string): RosterAsset {
  const asset = ROSTER.find((a) => a.assetId === assetId);
  if (!asset) throw new Error(`unknown roster asset ${assetId}`);
  return asset;
}
