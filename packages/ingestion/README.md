# COX price archiver

`@eox/ingestion` collects one-minute prices for the 30-asset COX roster, preserves source evidence and writes canonical snapshots to PostgreSQL. It accesses exchanges through [price-feeds](../price-feeds/README.md) and persists data through [evidence-store](../evidence-store). It does not publish to Solana or compute market references.

## Run

Install workspace dependencies and apply the evidence-store migrations before starting:

```sh
DATABASE_URL=postgres://localhost/cox \
COX_USER_AGENT='COX/1.0 (contact: ops@example.com)' \
COX_ARCHIVER_STATE_DIR=./state \
pnpm --filter @eox/ingestion cox:archiver
```

Replace the example contact with an address monitored by the operator.

| Variable | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL evidence store | Required |
| `COX_USER_AGENT` | Venue request identity and operator contact | Required |
| `COX_ARCHIVER_STATE_DIR` | Persistent listing-check state | Required |
| `COX_CATCH_UP_MINUTES` | Maximum recent recovery window, 0–60 minutes | `3` |
| `COX_BYBIT_ENABLED` | Set `true` to enable Bybit where permitted and reachable | Disabled |
| `COX_COINBASE_ENABLED` | Set `false` to disable Coinbase | Enabled |

Use one archiver instance per database and roster. Preserve the state directory between restarts. The systemd deployment is documented in the [deployment guide](../../deploy/dev/README.md).

## Collection cycle

The loop starts six seconds after each minute boundary. For each cutoff it resolves every asset in canonical order, preserving:

- Exact source responses in `source_payloads` and `venue_responses`.
- Every fallback attempt in `venue_attempts`.
- Selected prices and their evidence in `price_observations`.
- A final `snapshots` row identifying the completed cutoff.

Venue failures, unresolved or rejected assets, collection completed after cutoff +30 seconds, and listing changes are recorded as incidents. A delayed archive is evidence of collection timing; it is not a price from a different observation time.

After restart, the loop catches up recent cutoffs in order within the configured window. Older missed cutoffs become `archive_late` incidents; prices are not invented to fill gaps. Listing metadata is checked daily and saved in the private state directory. Structured logs report cutoff outcomes and venue metrics.

## Commitments and precision

Price and snapshot digests follow `COX/WIRE/V1`, defined in the [COX specification](../cox/SPEC.md). `src/cox/digest.ts` is tested against shared methodology wire vectors. A canonical snapshot digest is emitted only when every roster asset has an admissible price.

Snapshots archived before migration `011` contain an unlabelled provisional digest. Treat them as historical records rather than canonical COX commitments.

Kraken and Coinbase closes must match `^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$` exactly. A ninth fractional digit is rejected, including a trailing zero. Bybit conversions use the separately specified USDT/USD rounding policy.

## Feed report

```sh
pnpm --filter @eox/ingestion cox:feed-check 7
```

The optional argument is the lookback in days. The report summarizes each asset's inadmissible share, venue and fallback usage, longest trade age, venue response counts and rate-limited attempts. It fails the per-asset availability criterion above 0.1% inadmissible cutoffs. Cutoffs marked `archive_late` are reported separately and excluded from venue shares.

A report describes the data actually collected in its window; choosing seven days does not establish that seven complete days exist.

## Verification

```sh
pnpm --filter @eox/ingestion build
pnpm --filter @eox/ingestion test
```

Database integration tests require the local test PostgreSQL service on port 5433. Consumers read completed snapshots through the [evidence API](../../apps/evidence-api/README.md).
