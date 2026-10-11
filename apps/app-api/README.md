# app-api (Joel)

## COX: `cox.app-api/v1` (`product.md` J3 and J5)

```bash
APP_API_SOURCE=cox-fixture pnpm --filter @eox/app-api-server start   # http://127.0.0.1:8790; APP_API_CORS_ORIGIN=* to allow browsers
APP_API_SOURCE=cox-live COX_RPC_URL=https://api.devnet.solana.com APP_API_STATE_DIR=./state   APP_API_PORT=8791 pnpm --filter @eox/app-api-server start             # live devnet pool 0
```

Live settings: `COX_NETWORK` (`solana-devnet`; the RPC's genesis hash must
match), `COX_POOL_ID` (default `0`), `COX_IDL_PATH` (default
`packages/cox/idl/cox.json`), `COX_POLL_MS` (default 5000). Until the pool
exists with a sealed methodology the service logs and checks again every 30 s.

**Public fixture URL:** `https://cox-app-api-529206295845.us-central1.run.app`
(Cloud Run `cox-app-api`, us-central1, open to anyone, CORS `*`, read-only,
fixture data only). Use it as `baseUrl`; `/health` answers `{"status":"ok"}`.
The service account `cox-app-api` holds no permissions. Redeploy after a change
with the image from `apps/app-api/Dockerfile`.

Fixture wallets for `/v1/wallets/:owner/portfolio`:

| Wallet | What it shows |
|---|---|
| `HgC4Jn7XMLzNsDjVdsr1x7BDuGBb2SBvx5TFLSUYaEyU` | two filled requests (deposit, redemption) and one queued deposit; a payable |
| `7TKNJWWpjcVWsnwo9TJvJyBMFLDwvgpKdDxPqmfw87cp` | a deposit and a switch, holding two classes |
| `GBZafz1m5qSDc3br2zEa2YG4hvQqj5DESk694byEwcNa` | a CRYPTO-class deposit |
| `3vdUxQYrGNUPyK1QNDkeyXDDfHvgTE3JQZjKZ6pUr4rX` | a deposit rejected on its condition; refundable |
| `HEkyBsK77wJPKjd4WS3d2auyJZqdwmVJt9w1SE2Uq9jZ` | a deposit expired over the missed batch; refundable |

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
| `POST /v1/transactions/deposit` | `{ owner, toClass, amount, minimumUnits, expiryBatch }` → unsigned transaction (live only) |
| `POST /v1/transactions/switch` | `{ owner, fromClass, toClass, units, minimumUnits, expiryBatch }` |
| `POST /v1/transactions/redeem` | `{ owner, fromClass, units, minimumProceeds, expiryBatch }` |
| `POST /v1/transactions/cancel`, `/refund` | `{ owner, requestId }` |
| `POST /v1/transactions/withdraw` | `{ owner, amount }` |
| `POST /v1/transactions/submit` | `{ transaction }`: the wallet-signed bytes, base64; relayed unchanged |
| `GET /v1/transactions/:signature` | `submitted`, `confirmed`, `finalized`, `failed` or `expired`, with the signed bytes as submitted |

Errors: `NO_PUBLICATION`, `PUBLICATION_NOT_FOUND`, `UNKNOWN_ASSET`,
`UNKNOWN_CLASS`, `UNKNOWN_WALLET`, `INVALID_REQUEST`, `NOT_FOUND`,
`METHOD_NOT_ALLOWED`, `INTERNAL_ERROR`, `NOT_LIVE` (409, builders on the
fixture), `TRANSACTION_REJECTED` (422, the program refused it in simulation; the
message carries the program's error), `TRANSACTION_NOT_FOUND`.

The API never computes references or claim values. The fixture
(`fixtures/cox-fixture.json`) is produced by Peter's P1 oracle
(`packages/cox-methodology/src/vectors.ts`: `reference`, `revalue`, `batch`) over a
connected timeline of two synthetic assets (`SYNA`, `SYNB`) and CRYPTO: deposits
into empty classes, MVP-0 redistribution, a switch, a redemption, a failed
condition, a missed batch and an expiry, with one deposit still queued. Prices and
wallets are synthetic. The timeline is anchored so its latest publication is the
latest minute. Regenerate with `npx tsx scripts/cox-fixture.ts` after the oracle
changes; a test fails if the file differs from what the oracle produces.

### The live source

`APP_API_SOURCE=cox-live` reads the deployed `cox` program through Peter's
`@cox/client` readers and the released IDL; it signs nothing and holds no key.

- **Publications.** Every publication is its own account (`"publication"`, pool,
  sequence), so the indexer reads sequences `0..pool.sequence` at `finalized`,
  checks each one's state digest, manifest and predecessor digest against the
  previous one, reads its batch account (must be committed) for the fixed
  valuation and flows, and appends it to `publications-<pool>.jsonl` in the state
  directory. That log is append-only, refuses another program or pool, and drops
  a partly written last line after a crash. `finalization.transaction` is the
  oldest successful transaction that touched the publication account.
- **Values.** Prices, references, class balances and the ledger come from the
  committed state preimage; nothing is recalculated. `gross`,
  `benchmarkGross` and `transferFactor` are `null` (not stored on chain).
  `ledger.refundable` is `null` live: the pool's `pending` includes refundable
  deposits and the split is only held per position. `flowResidual` is
  fixed backing + accepted deposits − new payables − final active backing,
  the same identity `finalize` adds to the residual.
- **Reconciliation.** Each tick reads the registry, pool and vault in one
  `getMultipleAccounts` call. `status.reconciliation` compares the vault's token
  balance with active + pending + payable + residual. `covered` is
  `vault ≥ ledger`, the program's own invariant (a surplus such as a direct token
  transfer is swept into the residual by the next value-moving instruction); a
  shortfall sets `status.state` to `incident`.
- **Portfolios.** The position is the committed view from `CoxReader` (staged
  credits stay hidden until their sequence commits); requests are the pool's
  request accounts with that owner (`getProgramAccounts` by owner). `requestId` is
  the request account address. Request states follow SPEC §8 codes 0–7,
  including `safety-rejected`. A read that crosses a publication is retried.
- **Transactions.** Builders read the pool's next request nonce at `confirmed`,
  derive the position, request and token accounts, add an idempotent
  associated-token-account creation where the program pays out to the wallet
  (switch, redeem, refund, withdraw), and simulate the transaction before
  returning it. The wallet is the only signer and fee payer; the result is a
  base64 version 0 transaction for the wallet to sign. Two wallets that build
  against the same nonce race: one lands, the other fails and must rebuild.
  `targetBatch` is the batch open when it was built; the program assigns the
  batch from its clock when the transaction lands.
- **Submission.** `submit` verifies every required signature, accepts only COX
  request instructions plus the associated token and compute budget programs,
  forwards the exact bytes to the RPC and records them in
  `submissions-<pool>.json`; a repeated submit returns the stored record.
- **Monitor.** `status.monitor` stays `null`: Godwin's monitor currently gives
  archive-scope verdicts per cutoff, not a recomputation of a publication.

The EOX reference API (countries, WORLD, pairs, devnet `eox-oracle` indexer and
its Rust fixture generator) was removed on 2026-10-10 and is kept at the
`eox-archive` tag.
