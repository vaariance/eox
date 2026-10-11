# app-api (Joel)

## COX: `cox.app-api/v1` (`product.md` J3)

```bash
APP_API_SOURCE=cox-fixture pnpm --filter @eox/app-api-server start   # http://127.0.0.1:8790
```

Use `createCoxApiClient` from `@eox/app-api`. Every response is
`{ schemaVersion: "cox.app-api/v1", deployment, status, data }`; `status` is
recomputed per request. Integers are decimal strings: prices USD × 10⁸, benchmark
and references at scale 10¹² (a reference of 100 is `"100000000000000"`), unit
quanta at 10¹² per unit, collateral in base units.

| Request | Data |
|---|---|
| `GET /v1/deployment` | origin (`fixture` or `live`), network, program, pool, test collateral, `COX/TRANSFER/MVP-0`, methodology label and draft/sealed status |
| `GET /v1/status` | latest publication sequence and batch, age, missed cutoffs, `fresh`/`delayed`/`halted`/`incident`/`paused`, whether a batch is executing, monitor verdict, current batch with its cutoff and +55 s acceptance deadline |
| `GET /v1/assets`, `/v1/assets/:id` | class index, venue symbols and the latest published price with venue, step and trade age |
| `GET /v1/crypto` | label and exact `1/N` weights |
| `GET /v1/publications/latest`, `/v1/publications/:sequence` | identity (sequence **and** scheduled batch, predecessor, missed batches, digests), prices, benchmark and references with gross returns, each class's pre-revaluation, fixed and final backing and units with its transfer factor, flows, ledger (`active`, `pending`, `refundable`, `payable`, `residual`, `vault`) |
| `GET /v1/publications?after=&limit=`, `/v1/publications/stream` | paged and resumable (SSE `Last-Event-ID`) publications from sequence 0 |
| `GET /v1/wallets/:owner/portfolio` | positions (units, locked), payable, refundable, pending, and every request with its target and expiry batch, state and receipt |

Errors: `NO_PUBLICATION`, `PUBLICATION_NOT_FOUND`, `UNKNOWN_ASSET`,
`UNKNOWN_CLASS`, `UNKNOWN_WALLET`, `INVALID_REQUEST`, `NOT_FOUND`,
`METHOD_NOT_ALLOWED`, `INTERNAL_ERROR`.

The API never computes references or claim values. The fixture
(`fixtures/cox-fixture.json`) is produced by Peter's P1 oracle
(`packages/cox-methodology/src/vectors.ts`: `reference`, `revalue`, `batch`) over a
connected timeline of two synthetic assets (`SYNA`, `SYNB`) and CRYPTO: deposits
into empty classes, MVP-0 redistribution, a switch, a redemption, a failed
condition, a missed batch and an expiry, with one deposit still queued. Prices and
wallets are synthetic. The timeline is anchored so its latest publication is the
latest minute. Regenerate with `npx tsx scripts/cox-fixture.ts` after the oracle
changes; a test fails if the file differs from what the oracle produces.

Transaction builders, quotes and the live source wait for Peter's P3 program
and IDL (SPEC §10: no unsigned transactions against an invented program ID).

The EOX reference API (countries, WORLD, pairs, devnet `eox-oracle` indexer and
its Rust fixture generator) was removed on 2026-10-10 and is kept at the
`eox-archive` tag.
