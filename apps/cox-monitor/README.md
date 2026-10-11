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

## Verdicts

Read-only, schema `cox.monitor/v1`, every verdict has `scope: "archive"`.

| Request | Returns |
| --- | --- |
| `GET /v1/verdicts/latest` | the newest verdict; 404 `NO_VERDICT` before the first check |
| `GET /v1/verdicts/:cutoff` | the verdict for one cutoff; 404 `VERDICT_NOT_FOUND` |
| `GET /v1/verdicts?limit=` | recent verdicts, newest first (1 to 1440, default 60) |
| `GET /healthz` | counts, whether it has started, the latest cutoff |

## Calculations it can already reproduce

Written from `packages/cox/SPEC.md` and matched against the published vectors,
without importing `@cox/methodology` or `packages/cox-client`: references and
CRYPTO (§4), MVP-0 revaluation (§5), fixed-value batch flows (§6), price and
snapshot digests, receipt root and state digest (§3).

## Not done yet

- It does not read publications from the `cox` program, so it does not yet
  compare its own references, revaluation, receipts or state digest with what
  was committed. That needs a live pool.
- It does not re-fetch candles from the venues. The archive is checked against
  itself, not yet against Kraken, Coinbase and Bybit.
- It does not model the SPEC §11 safety pass or capacity caps.
- A `match` here means the archive is internally consistent. It does not mean
  a venue's price was true.
