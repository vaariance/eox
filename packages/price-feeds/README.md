# price-feeds (Joel)

The only code in the repository that calls an exchange (`product.md` J0,
`SYSTEM.md` v2.3 §3.2 and §10.1). The archiver (J1) and the monitor (G2) import it.

```bash
pnpm --filter @eox/price-feeds test   # recorded responses only; no test calls a live venue
```

## What it provides

| Export | Purpose |
|---|---|
| `ROSTER`, `USDT_USD` | the 30 assets in canonical order with their Kraken, Coinbase and Bybit symbols |
| `KrakenWsFeed` | one WebSocket v2 connection subscribed to `ohlc` interval 1 for every symbol; keeps the raw frames per symbol per minute and the spans the connection covered |
| `VenueClient` | one per venue per process: rate budget, one request at a time, backoff, circuit breaker, cache, metrics |
| `krakenOhlc`, `coinbaseCandles`, `bybitKlines` | REST adapters returning the raw response with parsed candles |
| `resolveCutoffPrice`, `resolveUsdtUsd` | `COX/PRICE-FALLBACK/V1` for one asset and cutoff, with every attempt and its evidence |
| `verifyRange` | bulk re-fetch for the monitor (Kraken 720, Coinbase 300, Bybit 1,000 candles per call) |
| `exactE8`, `convertedE8` | USD × 10⁸: exact for Kraken and Coinbase, `COX/USDT-USD/V1` rounding for Bybit |

## Rules it enforces

- Budgets are at most half each venue's published limit: Kraken REST 0.5/s,
  Coinbase 2/s, Bybit 2/s. A higher configured budget throws. Every request
  carries the configured `User-Agent`, which must name COX and a contact.
- Rate limits (`429`, Kraken `EAPI:Rate limit exceeded`, Bybit `10006`/`10018`)
  back off with jitter, honouring `Retry-After`; a request that cannot finish
  before the caller's deadline fails as `rate-limited`. Five consecutive
  failures open a 60-second breaker (`unavailable`). Identical requests within
  a minute are served from the cache.
- Prices are read as the source's text: JSON numbers keep their source digits
  (Kraken WebSocket and Coinbase send numbers). More than eight significant
  decimals makes a Kraken or Coinbase close inadmissible (`excess_decimals`).
- An empty minute is decided per venue: Kraken REST `count = 0`; Kraken
  WebSocket no update for a minute the connection fully covered (otherwise the
  minute is repaired from REST); Coinbase an omitted candle, final five seconds
  after the minute; Bybit volume 0, final once a later candle exists. A Kraken
  or Bybit candle missing from its response is `unavailable`, never `empty`.
- The fallback walks Kraken → Coinbase → Bybit → Kraken's carried close; it
  queries a fallback venue only when the previous step had no trade, records
  unlisted venues as `not-listed`, and never averages venues. Bybit needs a
  USDT/USD price with trades in the same cutoff minute (Kraken, then Coinbase).
- A carried close older than 30 minutes is kept as `trade_age_exceeded`.

Bybit refuses US IPs; the dev VM runs in `europe-west1-b` for that reason. Pass
`bybit: null` to disable it, and the step is recorded as `unavailable`.
