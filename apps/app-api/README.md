# app-api (Joel)

The app-facing reference API from `product.md` §8.12 and §9 step 2. It serves the
schema in `@eox/app-api` (`packages/app-api`) from a pluggable source. Today the
only source is the **fixture**; the live source (step 9) implements the same
`ReferenceSource` interface, so clients do not change.

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
| `GET /v1/publications?after=&limit=` | finalized publications after a sequence |
| `GET /v1/publications/stream` | server-sent events; resume with `Last-Event-ID: <sequence>` |

Errors are `{ schemaVersion, error: { code, message } }` with codes
`NO_ACCEPTED_REFERENCE`, `SNAPSHOT_NOT_FOUND`, `INVALID_PAIR`, `UNKNOWN_COUNTRY`,
`INVALID_REQUEST`, `NOT_FOUND`, `METHOD_NOT_ALLOWED` and `INTERNAL_ERROR`.

A pending proposal never replaces the latest accepted snapshot. The API never
calculates a reference: every value comes from the oracle.

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
