# evidence-api (Joel)

Read-only HTTP service over the evidence store. The COX publisher and monitor
read archived prices and their source evidence here and never touch the
database. Contract: `SYSTEM.md` §5 and `packages/cox/SPEC.md`.

```bash
pnpm --filter @eox/evidence-api start   # http://127.0.0.1:8787, DATABASE_URL from the environment
pnpm --filter @eox/evidence-api test
```

| Request | Returns |
|---|---|
| `GET /v1/prices/cutoffs/:cutoff`, `GET /v1/prices/changes` | below |
| `GET /v1/artifacts/:sha256` | the exact raw source response; `x-content-sha256` and `x-source-content-type` headers |
| `GET /health` | `{ status: "ok" }` |

Every other method or path is refused. Inputs are validated against strict
patterns before reaching the database. The EOX routes (`/v1/changes`,
`/v1/records/...`) were removed on 2026-10-10; they are kept at the
`eox-archive` tag, and their data stays in the database read-only.

## COX prices

`product.md` J2. Read-only views of what the archiver (`cox-archiver`) stored;
the API never computes a price or a reference.

| Request | Returns |
|---|---|
| `GET /v1/prices/cutoffs/:cutoff` | the archived snapshot for one cutoff (Unix seconds on a minute boundary): `snapshot` (`digest`, `digestEncoding`, `admissible`, `recordedAtMs`; `digest` is the `COX/WIRE/V1` snapshot digest, null when the snapshot is inadmissible, and unlabelled for snapshots archived before migration `011`), then for every asset in canonical order its fallback `attempts` (`step`, `venue`, `outcome`, `artifactDigest`) and the chosen `price` (`venue`, `step`, `candleStart`, `close` as the venue's text, `usdtUsd` and `usdtArtifactDigest` for Bybit, `priceE8` at scale 10⁸, `tradeEvidence`, `tradeAgeMinutes`, `artifactDigest`, `admissible`, `rejection`), the USDT/USD attempts and the cutoff's `incidents`. 404 until the snapshot row exists, so a cutoff still being archived is never served |
| `GET /v1/prices/changes?after=&limit=` | `{ after, cutoffs: [{ cutoff, admissible, snapshotDigest }] }`, archived cutoffs in commit order; pass the returned `after` back. Pages only include snapshots whose inserting transaction is older than every transaction still running (migration `010`), so a snapshot that commits late is never skipped; an empty page returns the same `after` |

Every `artifactDigest` is retrievable from `/v1/artifacts/:sha256`. A Kraken
WebSocket artifact is the ordered raw frames for that candle, one per line.
