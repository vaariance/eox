# @eox/ingestion (Joel)

The COX price archiver, its digests and the feed-check report. Exchange access
goes only through `@eox/price-feeds`; storage through `@eox/evidence-store`.

```bash
pnpm --filter @eox/ingestion cox:archiver          # the per-minute loop (systemd cox-archiver on the dev VM)
pnpm --filter @eox/ingestion cox:feed-check [days] # the J1 feed report
pnpm --filter @eox/ingestion test                  # needs the local Postgres on port 5433
```

The EOX economic-indicator pipelines (OECD, BIS, IMF PortWatch) were removed on
2026-10-10. Their code and documentation are at the `eox-archive` tag; their data
stays in the database read-only.

## COX price archiver

`src/cox/archiver.ts` (systemd `cox-archiver` on the dev VM) archives every
one-minute cutoff for the 30 COX assets (`product.md` J1, `SYSTEM.md` v2.3
§3.2 and §5.1). It runs six seconds after each minute: for each asset it calls
`resolveCutoffPrice` from `@eox/price-feeds`, stores every venue response in
`source_payloads` and `venue_responses`, every fallback step in
`venue_attempts`, and the chosen price in `price_observations`, then writes the
cutoff's `snapshots` row in canonical order. Venue failures, unresolved or
inadmissible assets, a snapshot finished after cutoff + 30 s and listing changes
are recorded in `incidents`. After a restart it catches up at most
`COX_CATCH_UP_MINUTES` (default 3) missed cutoffs in order; older ones are
recorded as `archive_late`, never invented.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | evidence store |
| `COX_USER_AGENT` | sent to every venue; must name COX and a contact |
| `COX_ARCHIVER_STATE_DIR` | holds the last listing check |
| `COX_BYBIT_ENABLED` | `true` only where Bybit is reachable and permitted |
| `COX_COINBASE_ENABLED` | `false` disables Coinbase |

Price and snapshot digests follow `COX/WIRE/V1` (`packages/cox/SPEC.md` §3) in
`src/cox/digest.ts`; `test/cox-digest.test.ts` checks them byte for byte against
the P1 wire vectors. A digest exists only for a complete admissible snapshot (one
price for every roster asset, none rejected). Snapshots recorded before migration
`011` carry an unlabelled provisional digest (`digest_encoding` null) and must
not be compared with `COX/WIRE/V1`. Kraken and Coinbase closes must match
`^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$` exactly; even a ninth trailing zero is
`excess_decimals`.

Feed check: `pnpm --filter @eox/ingestion cox:feed-check [days]` prints, per
asset, the share of inadmissible cutoffs (fails above 0.1%), the share resolved
by each venue and step and the longest trade age, and per venue the archived
responses and rate-limited attempts. Cutoffs the archiver itself finished late (`archive_late`: restarts, deploys, catch-up) are counted separately and excluded from the per-asset shares, because they say nothing about the venues.
