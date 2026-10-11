import { type CandlePage, USDT_USD, VenueClient, coinbaseCandles, krakenOhlc, rosterAsset, verifyRange } from "@eox/price-feeds";
import type { ArchiveVenue } from "./archive.js";
import { type CandleSource, USDT } from "./venue-check.js";

export const MONITOR_REQUESTS_PER_SECOND: Record<ArchiveVenue, number> = { kraken: 0.25, coinbase: 1, bybit: 1 };
const TIMEOUT_MS = 120_000;

export function venueCandleSource(userAgent: string): CandleSource {
  const clients = {
    kraken: new VenueClient("kraken", { requestsPerSecond: MONITOR_REQUESTS_PER_SECOND.kraken, userAgent }),
    coinbase: new VenueClient("coinbase", { requestsPerSecond: MONITOR_REQUESTS_PER_SECOND.coinbase, userAgent }),
    bybit: new VenueClient("bybit", { requestsPerSecond: MONITOR_REQUESTS_PER_SECOND.bybit, userAgent }),
  };

  async function page(venue: ArchiveVenue, assetId: string, from: number, to: number): Promise<CandlePage> {
    const deadline = Date.now() + TIMEOUT_MS;
    if (assetId !== USDT) return verifyRange(clients, venue, rosterAsset(assetId), from, to, deadline);
    if (venue === "kraken") return krakenOhlc(clients.kraken, USDT_USD.krakenRestPair, from - 60, deadline);
    if (venue === "coinbase") return coinbaseCandles(clients.coinbase, USDT_USD.coinbaseProduct, from, to, Math.floor(Date.now() / 1000), deadline);
    throw new Error("USDT/USD is not resolved on Bybit");
  }

  return {
    async candles(venue, assetId, from, to) {
      const result = await page(venue, assetId, from, to);
      if (result.notListed) return "not-listed";
      return result.candles
        .filter((candle) => candle.start >= from && candle.start < to)
        .map((candle) => ({ start: candle.start, close: candle.close, hasTrades: candle.hasTrades, final: candle.final }));
    },
  };
}
