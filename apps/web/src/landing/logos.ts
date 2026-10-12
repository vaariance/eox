const LOCAL: ReadonlySet<string> = new Set(["BTC", "ETH", "SOL", "XRP", "BNB", "TRX", "AVAX", "DOT", "NEAR", "SUI", "APT", "UNI", "ARB", "OP", "AAVE", "ZEC", "STRK", "TAO", "FET", "JUP", "TIA", "RENDER", "USDC"]);

export function localLogo(id: string): string | null {
  return LOCAL.has(id) ? `/tokens/${id.toLowerCase()}.svg` : null;
}
