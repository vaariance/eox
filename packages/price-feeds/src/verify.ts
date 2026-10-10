import type { RosterAsset } from "./roster.js";
import type { VenueClient } from "./venue-client.js";
import { bybitKlines, coinbaseCandles, krakenOhlc, type CandlePage } from "./venues/rest.js";

export const BULK_LIMITS = { kraken: 720, coinbase: 300, bybit: 1000 } as const;

export interface VerifyClients {
  kraken: VenueClient;
  coinbase: VenueClient | null;
  bybit: VenueClient | null;
}

export async function verifyRange(
  clients: VerifyClients,
  venue: "kraken" | "coinbase" | "bybit",
  asset: RosterAsset,
  from: number,
  to: number,
  deadline: number,
): Promise<CandlePage> {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from % 60 !== 0 || to % 60 !== 0 || to <= from) {
    throw new Error("verifyRange needs minute-aligned from < to");
  }
  if ((to - from) / 60 > BULK_LIMITS[venue]) throw new Error(`${venue} returns at most ${BULK_LIMITS[venue]} candles per call`);
  if (venue === "kraken") return krakenOhlc(clients.kraken, asset.krakenRestPair, from - 60, deadline);
  if (venue === "coinbase") {
    if (!clients.coinbase || asset.coinbaseProduct === null) throw new Error(`${asset.assetId} has no Coinbase market in use`);
    return coinbaseCandles(clients.coinbase, asset.coinbaseProduct, from, to, Math.floor(Date.now() / 1000), deadline);
  }
  if (!clients.bybit || asset.bybitSymbol === null) throw new Error(`${asset.assetId} has no Bybit market in use`);
  return bybitKlines(clients.bybit, asset.bybitSymbol, from, to, deadline);
}
