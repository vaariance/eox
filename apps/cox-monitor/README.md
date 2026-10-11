# COX archive monitor

An independent, read-only checker for archived COX price snapshots. It verifies archive consistency and can compare archived candles with the source venues. It holds no signing key and cannot publish, pause trading or change protocol state.

## Run locally

Install the workspace dependencies, then run from the repository root:

```sh
pnpm --filter @eox/cox-monitor start
```

The default evidence API is `http://127.0.0.1:8787`, and the verdict server listens on `127.0.0.1:8792`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `EVIDENCE_API_URL` | `http://127.0.0.1:8787` | Archived-price evidence API. |
| `MONITOR_STATE` | `cox-monitor-state.json` | Persistent progress and verdict file. |
| `MONITOR_HOST`, `MONITOR_PORT` | `127.0.0.1`, `8792` | Verdict server address. |
| `MONITOR_INTERVAL_SECONDS` | `20` | Interval between archive checks. |
| `MONITOR_PAGE_SIZE`, `MONITOR_MAX_PAGES` | `50`, `20` | Cutoffs per page and maximum pages per check. |
| `MONITOR_VENUE_CHECK` | Disabled | Set to `true` to query source venues. |
| `MONITOR_USER_AGENT` | Unset | Required for venue checks; identifies COX and a contact address. |
| `MONITOR_VENUE_INTERVAL_SECONDS` | `600` | Interval between venue sweeps. |

## Verification scope

For each archived cutoff, the monitor independently converts venue closes to USD at scale 10⁸, checks the archived fallback order, reconstructs the snapshot digest, verifies artifact hashes and compares the change-feed entry with its cutoff record. Bybit conversion uses the archived USDT/USD rate.

Archive verdicts are `match`, `mismatch`, `skipped` or `inadmissible`. `skipped` identifies snapshots written before the supported `COX/WIRE/V1` digest format. Progress is saved after every page so restarts resume from the stored cursor.

Optional venue checks verify the used candle, earlier empty fallback steps, carried Kraken prices and the Bybit conversion rate through `@eox/price-feeds`. A cutoff waits three minutes before checking. Requests are sequential and bounded: Kraken at most one request per four seconds; Coinbase and Bybit at most one per second. Candle retention can prevent verification of older cutoffs.

Venue results are `pending`, `confirmed`, `mismatch`, `unverified` or `not-checked`. A venue mismatch also changes the overall verdict to `mismatch`.

## Read-only API

Responses use schema `cox.monitor/v1`; verdicts have `scope: "archive"`.

| Endpoint | Response |
| --- | --- |
| `GET /v1/verdicts/latest` | Latest verdict; 404 `NO_VERDICT` before the first check. |
| `GET /v1/verdicts/:cutoff` | Verdict for a cutoff; 404 `VERDICT_NOT_FOUND` if absent. |
| `GET /v1/verdicts?limit=` | Newest verdicts first; default 60, range 1–1440. |
| `GET /health`, `GET /healthz` | Startup status, counts and latest cutoff. |

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

The server has no authentication layer. Keep the default loopback binding or place it behind an access-controlled gateway when exposing it remotely.

## Limits

The monitor checks archives rather than reading COX program publications. Its independent calculation modules implement references, CRYPTO, MVP-0 revaluation, fixed-value batch flows and commitment digests against the specification vectors. Those calculations are not currently an on-chain reconciliation service, and they do not model the safety pass or capacity caps.

A matching archive is internally consistent. A confirmed venue check means the venue returns matching candles; neither result proves that the venue price represents a true or manipulation-free market price. Recorded-data tests do not establish successful operation against live venues.

## Deployment and development

```sh
pnpm --filter @eox/cox-monitor build
pnpm --filter @eox/cox-monitor test
apps/cox-monitor/deploy/deploy.sh
```

The deployment script requires `gcloud`, VM access and a clean monitor/price-feeds working tree. It accepts `GCP_PROJECT`, `GCP_ZONE` and `GCP_INSTANCE`, defaulting to the development environment. It bundles the app, installs a release under `/opt/cox-monitor/releases/<commit>` and restarts only systemd `cox-monitor`.

The supplied unit stores state in `/var/lib/cox-monitor/state.json`, processes up to five cutoffs per 20-second check and leaves venue checks disabled. Inspect it with `systemctl status cox-monitor` and `journalctl -u cox-monitor`.
