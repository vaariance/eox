# COX monitor

Independent checker for the COX devnet MVP (`product.md` task G2). It holds no
key, signs nothing and cannot pause anything. It reports; a person decides.

```sh
pnpm --filter @eox/cox-monitor start
pnpm --filter @eox/cox-monitor test
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `EVIDENCE_API_URL` | `http://127.0.0.1:8787` | Joel's evidence API |
| `MONITOR_STATE` | `cox-monitor-state.json` | where progress and verdicts are kept |
| `MONITOR_HOST`, `MONITOR_PORT` | `127.0.0.1`, `8792` | where verdicts are served |
| `MONITOR_INTERVAL_SECONDS` | `20` | pause between checks |
| `MONITOR_PAGE_SIZE`, `MONITOR_MAX_PAGES` | `50`, `20` | cutoffs read per request and requests per check; lower them to catch up gently |
| `MONITOR_VENUE_CHECK` | off | `true` re-fetches candles from the venues |
| `MONITOR_USER_AGENT` | none | required with the venue check; names COX and a contact address |
| `MONITOR_VENUE_INTERVAL_SECONDS` | `600` | pause between venue sweeps |

## What it checks today

It follows the evidence API's price change feed. For every archived cutoff it:

1. converts each venue close to USD × 10⁸ itself and compares it with the
   archived `priceE8` (Bybit closes use the archived USDT/USD rate);
2. checks the `COX/PRICE-FALLBACK/V1` order: no earlier step had trades, and an
   archived attempt shows trades at the step that was used;
3. rebuilds the `COX/WIRE/V1` snapshot digest and compares it;
4. fetches every archived artifact and checks it hashes to its digest;
5. checks that the change feed and the cutoff agree about the snapshot.

Each cutoff gets one verdict: `match`, `mismatch` (with findings), `skipped`
(digest written before `COX/WIRE/V1`) or `inadmissible` (no usable snapshot).
Progress is saved after every page, so a restart continues where it stopped.

## Checking against the venues

With `MONITOR_VENUE_CHECK=true`, every cutoff whose archive check matched is
later compared with the venues themselves, through `@eox/price-feeds` only:

- the close that was used must be the venue's close for that candle, and that
  candle must have trades;
- every earlier step the archive recorded as empty must have no trades at the
  venue;
- a carried Kraken close must be Kraken's last trade before the cutoff;
- a Bybit price's USDT/USD rate must be the venue's cutoff close.

Requests are bulk and sequential: one per venue and asset covers many cutoffs.
Budgets are a quarter of each venue's published limit or less (`SYSTEM.md`
§10.1): Kraken one request per 4 s, Coinbase and Bybit one per second. A
cutoff waits three minutes before it is checked so candles are final.

The result is each verdict's `venues` field: `pending`, `confirmed`,
`mismatch` (the verdict itself becomes `mismatch`), `unverified` (a venue no
longer returns the candle) or `not-checked`.

## Verdicts

Read-only, schema `cox.monitor/v1`, every verdict has `scope: "archive"`.

| Request | Returns |
| --- | --- |
| `GET /v1/verdicts/latest` | the newest verdict; 404 `NO_VERDICT` before the first check |
| `GET /v1/verdicts/:cutoff` | the verdict for one cutoff; 404 `VERDICT_NOT_FOUND` |
| `GET /v1/verdicts?limit=` | recent verdicts, newest first (1 to 1440, default 60) |
| `GET /health`, `GET /healthz` | counts, whether it has started, the latest cutoff |

## Running on the dev VM

`deploy/deploy.sh` installs only the monitor and restarts no other service. It
bundles `src/main.ts` into one file, copies it to
`/opt/cox-monitor/releases/<commit>` on `eox-dev`, points
`/opt/cox-monitor/current` at it and starts systemd `cox-monitor` as its own
user `cox-monitor`. State is in `/var/lib/cox-monitor/state.json`. The unit
reads at most 5 cutoffs every 20 seconds so a backlog does not load the
evidence API, and leaves the venue check off.

```bash
apps/cox-monitor/deploy/deploy.sh
```

## Calculations it can already reproduce

Written from `packages/cox/SPEC.md` and matched against the published vectors,
without importing `@cox/methodology` or `packages/cox-client`: references and
CRYPTO (§4), MVP-0 revaluation (§5), fixed-value batch flows (§6), price and
snapshot digests, receipt root and state digest (§3).

## Not done yet

- It does not read publications from the `cox` program, so it does not yet
  compare its own references, revaluation, receipts or state digest with what
  was committed. That needs a live pool.
- The venue check has only been tested against recorded-style candle data.
  It has not been run against the live venues.
- It does not model the SPEC §11 safety pass or capacity caps.
- A `match` means the archive is internally consistent, and `confirmed` means
  the venues return the same candles. Neither means a venue's price was true.
