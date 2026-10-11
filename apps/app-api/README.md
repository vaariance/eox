# COX application API

HTTP service for COX deployment information, publications, portfolios and wallet-signed transactions. It serves the `cox.app-api/v1` contract from either a deterministic fixture or a Solana devnet pool. It holds no wallet private key and does not calculate market references.

## Run locally

Install workspace dependencies from the repository root, then start the fixture:

```sh
pnpm --filter @eox/app-api-server start
```

The default address is `http://127.0.0.1:8790`. For a devnet source:

```sh
APP_API_SOURCE=cox-live \
COX_RPC_URLS=https://api.devnet.solana.com \
APP_API_STATE_DIR=./state \
APP_API_PORT=8791 \
pnpm --filter @eox/app-api-server start
```

The public demonstration endpoint is <https://cox-app-api-529206295845.us-central1.run.app>. It serves synthetic fixture data, not market data. The public live endpoint is <https://cox-app-api-live-529206295845.europe-west1.run.app>: Solana devnet pool 0 with test collateral only, one always-on Cloud Run instance, history rebuilt from the publisher's archive bucket on start, and transaction requests limited per client. Check `deployment.origin` on every integration rather than inferring the source from an endpoint's name.

## Configuration

| Variable | Purpose | Default |
|---|---|---|
| `APP_API_SOURCE` | `cox-fixture` or `cox-live` | `cox-fixture` |
| `APP_API_HOST`, `APP_API_PORT` | Listening interface and port | `127.0.0.1`, `8790` |
| `APP_API_CORS_ORIGIN` | Browser origin, or `*`; unset disables CORS headers | Unset |
| `COX_RPC_URLS` | Ordered, whitespace-separated HTTPS RPC URLs | Required for live mode |
| `APP_API_STATE_DIR` | Persistent publication and submission storage | Required for live mode |
| `COX_NETWORK` | Supported network | `solana-devnet` |
| `COX_POOL_ID` | Pool identifier | `0` |
| `COX_IDL_PATH` | Program IDL | `packages/cox/idl/cox.json` |
| `COX_POLL_MS` | Indexer interval, at least 1,000 ms | `5000` |
| `COX_PUBLICATION_ARCHIVE` | Directory of the publisher's `<sequence>.json` archive records | Unset |
| `COX_PUBLICATION_ARCHIVE_GCS` | `gs://bucket/prefix/` of content-addressed `<sequence>/<sha256>.json` records; use instead of the directory | Unset |
| `APP_API_POST_LIMIT_PER_MINUTE` | Transaction requests per client per minute; 429 `RATE_LIMITED` with `Retry-After` beyond it | `30` |
| `APP_API_TRUST_FORWARDED_FOR` | `true` behind Cloud Run: the client is the last `X-Forwarded-For` entry | Unset |

Every RPC endpoint must pass the devnet genesis check at startup. Network failures, 15-second timeouts, HTTP 429 and HTTP 5xx trigger failover. Store authenticated URLs privately. A missing pool or unsealed methodology delays startup and is checked again every 30 seconds.

## HTTP contract

Successful JSON responses contain `{ schemaVersion, deployment, status, data }`. Errors contain `{ schemaVersion, error: { code, message } }`. `/health` returns `{ "status": "ok" }`; this is process health, not a publication-readiness verdict.

All fixed-point quantities are decimal integer strings. Prices use USD × 10⁸; benchmark levels and references use 10¹²; a reference of 100 is `"100000000000000"`. Position units contain 10¹² quanta per unit. Collateral amounts use the mint's base units. Use `BigInt` for arithmetic.

| Route | Result |
|---|---|
| `GET /v1/deployment` | Network, program, pool, test collateral and methodology identity |
| `GET /v1/status` | Publication age, missed cutoffs, execution state and vault reconciliation |
| `GET /v1/assets`, `GET /v1/assets/:id` | Asset roster, venue symbols and latest published prices |
| `GET /v1/crypto` | Benchmark composition and exact weights |
| `GET /v1/publications/latest` | Latest indexed publication |
| `GET /v1/publications/:sequence` | Publication by sequence |
| `GET /v1/publications?after=&limit=` | Publications strictly after the cursor; default limit 100, maximum 500 |
| `GET /v1/publications/stream` | Server-sent events; resume with `Last-Event-ID` |
| `GET /v1/wallets/:owner/portfolio` | Committed positions, locked units, payables, refunds and requests |
| `POST /v1/transactions/deposit` | Build with `{ owner, toClass, amount, minimumUnits, expiryBatch }` |
| `POST /v1/transactions/switch` | Build with `{ owner, fromClass, toClass, units, minimumUnits, expiryBatch }` |
| `POST /v1/transactions/redeem` | Build with `{ owner, fromClass, units, minimumProceeds, expiryBatch }` |
| `POST /v1/transactions/cancel`, `POST /v1/transactions/refund` | Build with `{ owner, requestId }` |
| `POST /v1/transactions/withdraw` | Build with `{ owner, amount }` |
| `POST /v1/transactions/submit` | Relay `{ transaction }`, containing signed base64 transaction bytes |
| `GET /v1/transactions/:signature` | Track a transaction submitted through this API |

Omitting the publication cursor starts from sequence 0. An empty page preserves the cursor. SSE events contain the publication and its sequence; the server sends a heartbeat every 15 seconds. Transaction request bodies are limited to 8 KiB.

Errors include `NO_PUBLICATION`, `PUBLICATION_NOT_FOUND`, `UNKNOWN_ASSET`, `UNKNOWN_CLASS`, `UNKNOWN_WALLET`, `INVALID_REQUEST`, `NOT_FOUND`, `METHOD_NOT_ALLOWED`, `INTERNAL_ERROR`, `NOT_LIVE`, `TRANSACTION_REJECTED` and `TRANSACTION_NOT_FOUND`. Builders on the fixture return HTTP 409 `NOT_LIVE`; a rejected simulation returns HTTP 422 `TRANSACTION_REJECTED`.

## Wallet transaction flow

1. Request an unsigned transaction from a live source.
2. Inspect the decoded instructions, network, mint, amounts and expiry. The wallet must be the sole signer and fee payer.
3. Sign with the user's wallet, then submit the exact signed bytes.
4. Track the signature and the request receipt separately. Transaction confirmation acknowledges submission; a later committed publication determines the fill.

Builders simulate before returning a version 0 transaction. The program assigns eligibility from its clock when submission lands; the returned target batch is an estimate. The request nonce is pool-global, so simultaneous builds can conflict and a failed nonce must be rebuilt. After an ambiguous submission result, check the original signature and request before creating another deposit.

Submission verifies signatures, restricts instructions to the supported COX request operations plus associated-token and compute-budget programs, and relays the signed bytes unchanged. Redemption creates a payable; withdrawal is a separate wallet action. The devnet collateral is a test token, not real USDC.

## Live state and history

The source reads finalized program accounts through [the COX client](../../packages/cox-client/README.md). Staged position and request changes remain hidden until commitment. Vault reconciliation compares token balance with active + pending + payable + residual; a surplus remains covered until a financial instruction records it as residual.

Publications are stored in an append-only `publications-<pool>.jsonl` log, bound to the program and pool. A partial final line is discarded after a crash. Signed submissions use `submissions-<pool>.json`. Preserve both files across deployments.

**History limitation:** the current indexer requests successive sequences from on-chain readers. The program reuses its latest publication and batch accounts, so a sequence overwritten before indexing cannot be recovered by this service from chain alone. Complete restart and gap recovery require an external publication-history source; that recovery is not implemented here.

Live `gross`, `benchmarkGross` and `transferFactor` fields are `null` because they are not stored on chain. `ledger.refundable` is also `null`: the pool combines refundable deposits with pending funds, while individual portfolios expose the split. `status.monitor` is `null`; an archive consistency check is not a publication verification.

## Fixture and verification

The fixture uses two synthetic assets, `SYNA` and `SYNB`, plus CRYPTO. Its connected timeline covers deposits, revaluation, switching, redemption, conditions, missed batches, expiry and a queued request. Its timestamps advance to the current minute; the amounts remain synthetic.

Example portfolio owner: `HgC4Jn7XMLzNsDjVdsr1x7BDuGBb2SBvx5TFLSUYaEyU`.

```sh
pnpm --filter @eox/app-api-server build
pnpm --filter @eox/app-api-server test
```

To regenerate fixture output after a methodology change, run `npx tsx scripts/cox-fixture.ts` from this directory. See the [typed API client](../../packages/app-api/README.md) and [deployment guide](../../deploy/dev/README.md).
