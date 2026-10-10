import { decodeUtf8, parseLossless } from "./json.js";
import type { RosterAsset } from "./roster.js";
import { VenueError, type RawResponse, type RestVenue, type VenueClient } from "./venue-client.js";

export interface Listing {
  venue: RestVenue;
  symbol: string;
  listed: boolean;
  status: string | null;
  precision: string | null;
}

export interface ListingClients {
  kraken: VenueClient;
  coinbase: VenueClient | null;
  bybit: VenueClient | null;
}

function json(response: RawResponse): Record<string, unknown> | unknown[] {
  try {
    return parseLossless(decodeUtf8(response.body)) as Record<string, unknown> | unknown[];
  } catch {
    throw new VenueError(response.venue, "malformed", "listing response is not JSON", response);
  }
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export async function fetchListings(clients: ListingClients, roster: readonly RosterAsset[], deadline: number): Promise<Listing[]> {
  const listings: Listing[] = [];
  const pairs = roster.map((a) => a.krakenRestPair);
  const kraken = json(await clients.kraken.get(`https://api.kraken.com/0/public/AssetPairs?pair=${pairs.join(",")}`, deadline)) as { result?: Record<string, Record<string, unknown>> };
  for (const pair of pairs) {
    const entry = kraken.result?.[pair];
    listings.push({ venue: "kraken", symbol: pair, listed: Boolean(entry), status: text(entry?.status), precision: text(entry?.pair_decimals) });
  }
  if (clients.coinbase) {
    const products = json(await clients.coinbase.get("https://api.exchange.coinbase.com/products", deadline));
    const byId = new Map((Array.isArray(products) ? products : []).map((p) => [text((p as Record<string, unknown>).id), p as Record<string, unknown>]));
    for (const product of roster.map((a) => a.coinbaseProduct).filter((p): p is string => p !== null)) {
      const entry = byId.get(product);
      listings.push({ venue: "coinbase", symbol: product, listed: Boolean(entry), status: text(entry?.status), precision: text(entry?.quote_increment) });
    }
  }
  if (clients.bybit) {
    const info = json(await clients.bybit.get("https://api.bybit.com/v5/market/instruments-info?category=spot", deadline)) as { result?: { list?: Record<string, unknown>[] } };
    const bySymbol = new Map((info.result?.list ?? []).map((i) => [text(i.symbol), i]));
    for (const symbol of roster.map((a) => a.bybitSymbol).filter((s): s is string => s !== null)) {
      const entry = bySymbol.get(symbol);
      const filter = entry?.priceFilter as Record<string, unknown> | undefined;
      listings.push({ venue: "bybit", symbol, listed: Boolean(entry), status: text(entry?.status), precision: text(filter?.tickSize) });
    }
  }
  return listings;
}

const HEALTHY: Record<RestVenue, string> = { kraken: "online", coinbase: "online", bybit: "Trading" };

export function listingChanges(previous: readonly Listing[] | null, current: readonly Listing[]): string[] {
  const changes: string[] = [];
  const before = new Map((previous ?? []).map((l) => [`${l.venue}:${l.symbol}`, l]));
  for (const listing of current) {
    const key = `${listing.venue}:${listing.symbol}`;
    if (!listing.listed) changes.push(`${key} is no longer listed`);
    else if (listing.status !== HEALTHY[listing.venue]) changes.push(`${key} status is ${listing.status}`);
    const old = before.get(key);
    if (old && old.listed && listing.listed && old.precision !== listing.precision) changes.push(`${key} price precision changed from ${old.precision} to ${listing.precision}`);
  }
  return changes;
}
