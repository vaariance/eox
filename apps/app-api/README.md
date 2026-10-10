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

## EOX (to be removed)

The app-facing reference API from `product.md` §8.12 and §9 step 2. It serves the
schema in `@eox/app-api` (`packages/app-api`) from one of two sources behind the
same `ReferenceSource` interface, so clients do not change: the **fixture** and
the **live** source (step 9), which reads the `eox-oracle` program on Solana.

```bash
pnpm --filter @eox/app-api-server start   # http://127.0.0.1:8790, fixture data
pnpm --filter @eox/app-api-server test
```

Use the typed client from the UI instead of calling routes directly:

```ts
import { createAppApiClient } from "@eox/app-api";

const api = createAppApiClient({ baseUrl: "http://127.0.0.1:8790" });
const { data, status, deployment } = await api.latestReference();
const pair = await api.pair("US", "JP");
const subscription = api.subscribePublications(lastSeenSequence, (event) => { /* new snapshot */ });
```

## Endpoints

Every response is `{ schemaVersion, deployment, status, data }`. `deployment.origin`
is `"fixture"` or `"live"`. `status` is computed per request (age, staleness after
three hours, execution eligibility) and is separate from the committed snapshot
data. All index, confidence and baseline values are integer strings at scale
1,000,000.

| Request | Data |
|---|---|
| `GET /v1/deployment` | network, programs, origin |
| `GET /v1/references/latest` | latest accepted snapshot: identity, WORLD, every country/WORLD reference |
| `GET /v1/snapshots/:snapshotId` | the same for a historical snapshot |
| `GET /v1/references/latest/countries/:ISO2` (or under `/v1/snapshots/:id`) | one country/WORLD reference |
| `GET /v1/references/latest/pairs/:BASE/:QUOTE` (or under `/v1/snapshots/:id`) | country/country reference |
| `GET /v1/proposals/current` | the pending proposal and its UMA assertions, or `null` |
| `GET /v1/evidence/readiness` | per slot: ready, or why not |
| `GET /v1/publications?after=&limit=` | finalized publications after a sequence; without `after`, from the first (sequence 0). `nextAfter` is `null` until one is returned |
| `GET /v1/publications/stream` | server-sent events; resume with `Last-Event-ID: <sequence>` |

Errors are `{ schemaVersion, error: { code, message } }` with codes
`NO_ACCEPTED_REFERENCE`, `SNAPSHOT_NOT_FOUND`, `INVALID_PAIR`, `UNKNOWN_COUNTRY`,
`INVALID_REQUEST`, `NOT_FOUND`, `METHOD_NOT_ALLOWED` and `INTERNAL_ERROR`.

A pending proposal never replaces the latest accepted snapshot. The API never
calculates a reference: every value comes from the oracle.

## The live source

Set `APP_API_SOURCE=live` and:

| Variable | Meaning |
|---|---|
| `SOLANA_RPC_URL` | RPC endpoint, read at `finalized` commitment only |
| `SOLANA_NETWORK` | label reported in `deployment.network`, e.g. `solana-devnet` |
| `EVIDENCE_API_URL` | the evidence API (`apps/evidence-api`) |
| `APP_API_STATE_DIR` | directory for the indexer and readiness state files |
| `APP_API_POLL_MS` | poll interval, default 30,000 |
| `SOLANA_RPC_INTERVAL_MS` | minimum gap between indexer RPC calls, default 400 |

The program and registry come from `packages/oracle/idl/eox_oracle.json`.

- **Publications** come from an indexer that walks the registry's finalized
  transactions oldest first. It skips failed transactions, stops (and retries on
  the next poll) when a finalized transaction is not yet retrievable, decodes
  `ReferencePublished` events, and accepts one only if Peter's `ReferenceReader`
  reads the snapshot as published with the same sequence, epoch and
  postcommitment. Progress is saved after every transaction, so a restart
  resumes where it stopped. `finalization` carries the publishing transaction
  and slot.
- **Snapshots** are read with `ReferenceReader.readSnapshot`. `snapshotId` is the
  snapshot account, `epoch` the epoch id, `configurationDigest` the sealed
  on-chain configuration (not the methodology manifest digest), and `baselineId`
  the epoch's baseline snapshot. WORLD has no stale or saturated flag on chain, so
  none is reported.
- **Pairs** are computed by the program: `read_pair` is simulated at `finalized`
  with the registry authority as fee payer; nothing is signed or sent.
- **Proposal** is the registry's active snapshot and its status. `assertions` is
  empty until challenges go through UMA (`SYSTEM.md` §6.3).
- **Readiness** follows the evidence API change feed and keeps, per pilot slot
  (30 countries × six indicators), the record with the latest period, then the
  latest recording. It applies the worker's `assertReady` checks to the source's
  exact value. A slot that passes is `missing-assessment`, never `ready`, because
  confidence assessments do not exist yet.

## The fixture

- `fixtures/oracle-preview.json` holds values computed by Peter's
  `eox-oracle-math` crate over his synthetic scenarios in `packages/oracle/fixtures`:
  `baseline.json` is snapshot 1 and `us-improves.json` is snapshot 2. Country/WORLD
  values come from `preview`, country/country pairs from `reference`.
- `fixtures/timeline.json` is hand-written fixture metadata: snapshot identities,
  times relative to service start, and a pending proposal with one disputed evidence
  assertion and a pending snapshot assertion, each with a one-hour window.

The countries (US, JP, GB, NG) and indicators are Peter's synthetic test universe,
not the pilot methodology. A test fails if Peter's scenario files change without the
fixture being regenerated. Regenerate it with Docker (no local Rust needed):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W):/repo:ro" -v "$(pwd -W)/apps/app-api/fixtures:/out" \
  -e CARGO_TARGET_DIR=/tmp/target -w /repo/apps/app-api/fixture-generator rust:1-slim \
  bash -c "cargo build --release --locked && /tmp/target/release/eox-app-api-fixture-generator \
  /repo/packages/oracle/fixtures/baseline.json /repo/packages/oracle/fixtures/us-improves.json > /out/oracle-preview.json"
```

On Linux or macOS use `$(pwd)` instead of `$(pwd -W)` and drop `MSYS_NO_PATHCONV=1`.

## Not in this step

Trading endpoints (markets, quotes, positions, collateral, unsigned transactions,
candles) wait for Peter's exchange equations and instruction definitions (step 8).
They will be added to the same schema rather than invented here.
