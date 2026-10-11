# COX exchange price feeds

`@eox/price-feeds` provides exchange adapters, rate-limited access and deterministic cutoff-price resolution for the COX archiver and monitor. It preserves raw response bytes alongside parsed candles. Benchmark calculations and collateral accounting belong to the COX engines, outside this package.

## Exports

| Export | Purpose |
|---|---|
| `ROSTER`, `USDT_USD` | Canonical 30-asset roster and conversion pair, including venue symbols |
| `KrakenWsFeed` | Kraken WebSocket v2 one-minute OHLC feed, raw frames and connection coverage |
| `VenueClient` | Per-venue request queue, budgets, backoff, cache, circuit breaker and metrics |
| `krakenOhlc`, `coinbaseCandles`, `bybitKlines` | REST adapters returning raw responses and parsed candles |
| `resolveCutoffPrice`, `resolveUsdtUsd` | Cutoff resolution with fallback attempts and evidence |
| `verifyRange` | Bulk candle retrieval for independent checking |
| `exactE8`, `convertedE8` | Exact USD scaling and policy-defined USDT conversion |

Use one `VenueClient` per venue per process. Supply a `User-Agent` naming COX and an operator contact. `ResolverDeps` accepts a Kraken WebSocket feed and clients for REST repair and fallback; set optional venue clients to `null` to disable them.

## Price selection

`COX/PRICE-FALLBACK/V1` attempts Kraken, Coinbase, Bybit, then Kraken's last traded close. It records failures and missing listings as explicit outcomes and never averages venues. Bybit requires a traded USDT/USD conversion candle at the same cutoff, resolved from Kraken then Coinbase.

A cutoff is positive Unix seconds on a minute boundary. The target candle starts at `cutoff − 60`. The default resolution deadline is cutoff +30 seconds; callers can supply a different retrieval deadline for historical checking without changing the candle's observation time.

Empty-minute rules differ by venue:

| Venue | Empty-minute evidence |
|---|---|
| Kraken REST | Candle with `count = 0` |
| Kraken WebSocket | No update during a minute fully covered by the connection; gaps require REST repair |
| Coinbase | Omitted candle, checked at least five seconds after the minute ends |
| Bybit | Zero-volume candle, final once a later candle exists |

A missing Kraken or Bybit candle is `unavailable`, not `empty`. Resolution returns attempts even when no price can be selected. A carried Kraken close older than 30 minutes is retained as evidence but rejected with `trade_age_exceeded`.

## Exact values and evidence

Prices remain source text during parsing, including JSON numeric tokens. Kraken and Coinbase USD prices must have at most eight fractional digits and fit the unsigned 64-bit E8 representation. Extra fractional digits, including trailing zeros, are rejected. Bybit multiplies the USDT close by the cutoff's USDT/USD price and rounds to E8 using the conversion policy.

Every retrieved response includes its raw bytes and SHA-256. WebSocket evidence consists of ordered raw frames joined by newlines. Resolution includes the selected venue, fallback step, candle start, trade evidence, trade age and any rejection reason. An admissible price is still an observation from an external venue; the exchange does not cryptographically sign it.

## Request controls

| Venue | Maximum configured REST requests per second | Maximum candles per range call |
|---|---:|---:|
| Kraken | 0.5 | 720 |
| Coinbase | 2 | 300 |
| Bybit | 2 | 1,000 |

Higher configured budgets are rejected. Requests are serialized per client. HTTP 429 and recognized venue rate-limit responses trigger jittered backoff honoring `Retry-After`. Requests that cannot complete within their deadline report `rate-limited`. Five consecutive failures open a 60-second circuit breaker. Identical requests are cached for one minute.

These are per-process budgets; multiple processes sharing an outbound IP must budget their combined venue traffic. Bybit access depends on deployment location and venue restrictions. Disable it when access is unavailable or not permitted.

## Verification

```sh
pnpm --filter @eox/price-feeds build
pnpm --filter @eox/price-feeds test
```

Tests use recorded or constructed responses and do not call live exchanges. See the [archiver guide](../ingestion/README.md) for runtime configuration and the [COX specification](../cox/SPEC.md) for commitment formats.
