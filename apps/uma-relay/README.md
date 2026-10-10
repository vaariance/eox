# uma-relay (Godwin)

Operates `EoxContinuousAdapter` (`product.md` §8.3, §8.4, §8.11, §8.12). It posts the
claims the oracle worker hands it and keeps them moving. It never builds a claim and never
decides an outcome: the worker builds, UMA decides, the adapter records.

## Posting claims

The worker requests assertions over HTTP and keeps the returned IDs:

| Route | Body | Does |
|---|---|---|
| `POST /v1/assertions/evidence` | `proposal`, `precommitment`, `claim` | Posts one evidence claim under that proposal |
| `POST /v1/assertions/snapshot` | `claim` | Posts the proposal's snapshot claim |
| `GET /health` | | Liveness, no token needed |

`claim` is the Borsh claim of `packages/oracle/PROTOCOL.md` as lowercase `0x` hex;
`proposal` and `precommitment` are 32-byte lowercase `0x` hex. A success is

```json
{ "schemaVersion": "eox.uma-relay/v1", "assertionId": "0x…", "claimDigest": "0x…", "created": true }
```

`created` is `false` when the claim was already asserted, so a retry after a lost response
returns the same assertion and costs no second bond. Request evidence first, put the
returned IDs in the snapshot claim, then request the snapshot.

| Status | Code | Meaning |
|---|---|---|
| 400 | `INVALID_REQUEST` | Malformed body |
| 401 | `UNAUTHENTICATED` | No valid Google identity token for a listed caller |
| 422 | `CLAIM_REJECTED` | The adapter refuses the claim; `message` is its error, such as `WrongContext`, `UnknownEvidence`, `EvidenceMismatch` or `SnapshotAlreadyRegistered` |
| 503 | `UNDERFUNDED` | The asserter wallet cannot cover one UMA bond; nothing is sent |
| 503 | `NOT_CONFIRMED` | The transaction did not confirm; retry the same request |

Every claim is simulated before it is sent. Requests are posted one at a time from the
`uma-asserter` wallet, which approves the adapter for a bounded number of bonds (16) when
its allowance runs out.

## Settling, closing and publishing

Each `tick`:

1. **Sync.** Reads the adapter's `ClaimAsserted`, `RelayMessageRecorded`,
   `RelayMessagePublished` and `ProposalClosed` events from the last cursor.
2. **Settle.** Calls UMA `settleAssertion` for every pending assertion whose deadline has
   passed. A disputed assertion is retried until UMA has resolved it.
3. **Close.** Calls `close` for every proposal with a snapshot, using the evidence list
   read from the snapshot claim. The adapter refuses until every assertion has resolved.
4. **Publish.** Calls `publish` with the Wormhole fee for every recorded message that has
   not been published, in event-number order.

Every transaction is simulated first and sent only if the simulation succeeds. A sent
transaction is recorded in the state before waiting for its receipt; after a restart the
relay checks that transaction's outcome before sending again.

## Challenging

UMA only judges a claim somebody disputes; an undisputed claim is accepted after its hour.
The challenger (`pnpm --filter @eox/uma-relay challenger`, a separate process with the
`uma-challenger` key) is that somebody. Each tick it reads new evidence claims from
`ClaimAsserted`, checks each one that is still open, and records a verdict:

| Verdict | Meaning | Action |
|---|---|---|
| `valid` | Every check passed | none |
| `invalid` | A check proved the claim wrong | disputed on UMA when disputes are on |
| `pending` | A check could not run, for example the evidence API is down | checked again next tick |
| `disputed` | Disputed by this challenger or anyone else | none |
| `missed` | The window closed before a verdict or a dispute | none |

It disputes only what a check proves wrong and never treats "could not check" as wrong: a
lost dispute costs the bond and lowers that evidence's confidence (`product.md` §8.5).
Disputes are off unless `CHALLENGER_DISPUTE=true`; without it the challenger only reports.
To dispute it approves UMA for exactly one bond and calls `disputeAssertion`; if it cannot
afford the bond it holds the verdict and retries.

The one check today is `sourceSupportCheck`, against Joel's evidence API:

- the claim's record is served by `GET /v1/records/:recordId`;
- the claim's artifact digests include that record's `artifactDigest`;
- every artifact digest in the claim can be fetched from `GET /v1/artifacts/:sha256` and
  hashes to that digest.

Not checked yet: the claim's evidence digest, metadata digest and assessment digest
(`product.md` §8.8, §8.10). Recomputing them needs the worker's mapping from an evidence
fact to its record, the exact-value conversion and the eight confidence ratings behind
`assessment_digest`, none of which is published where a challenger can read it. Snapshot
claims are not checked at all: that needs the methodology's selection rules. A check is a
function from a decoded claim to a verdict, so these are added to the list when their
inputs exist.

## State

`readState` and `writeState` keep each process's progress in one JSON file, written
atomically: the relay's cursor, known proposals and in-flight transactions, and the
challenger's cursor and verdicts. Give the two processes different files. The chain is the source of truth: a relay started
with an empty state rebuilds everything from `startBlock` and publishes nothing twice.

## Signing

`Relay` and `Asserter` each take a `Sender` (`address`, `send(transaction, operation)`).
`remoteSender` is the one the service runs with: it builds an EIP-1559 transaction for the
role's key (`evm-relayer` for the relay, `uma-asserter` for claims, `uma-challenger` for
disputes) from Joel's signing service, asks the service to sign it, checks that the returned transaction
is the same one and recovers to that key, and broadcasts it. The request ID is derived from
the unsigned bytes, so a retry of the same bytes is idempotent and a rebuilt transaction is
a new request under the same operation ID (`settle:<assertion>`, `close:<proposal>`,
`publish:<proposal>:<event number>`, `assert:<claim digest>`, `approve:<token>:<amount>`,
`dispute:<assertion>`). The service never holds a private key
(`product.md` §8.14). Tests use a local Anvil key behind the same interfaces.

## Run

```bash
pnpm --filter @eox/uma-relay start
```

| Variable | Meaning | Default |
|---|---|---|
| `RPC_URL` | EVM RPC endpoint of the adapter's chain | required |
| `ADAPTER_ADDRESS` | Deployed `EoxContinuousAdapter` | required |
| `SIGNER_URL` | Signing service base URL | required |
| `STATE_PATH` | State file on a persistent disk | required |
| `ASSERTION_AUDIENCE` | Audience callers request their identity token for | required |
| `ASSERTION_CALLERS` | Comma-separated service accounts allowed to request assertions | none |
| `ASSERTION_HOST`, `ASSERTION_PORT` | Where the assertion API listens | `127.0.0.1`, `8792` |
| `SIGNER_AUDIENCE` | Identity-token audience | `SIGNER_URL` |
| `START_BLOCK` | Block the adapter was deployed in | `0` |
| `CONFIRMATIONS` | Blocks behind the head that events are read at | `2` |
| `TICK_SECONDS` | Pause between ticks | `30` |

The challenger reads `RPC_URL`, `ADAPTER_ADDRESS`, `SIGNER_URL`, `SIGNER_AUDIENCE`,
`STATE_PATH`, `START_BLOCK`, `CONFIRMATIONS` and `TICK_SECONDS` the same way, plus:

| Variable | Meaning | Default |
|---|---|---|
| `EVIDENCE_API_URL` | Joel's evidence API | required |
| `CHALLENGER_DISPUTE` | `true` to send disputes; anything else only reports | off |

Both processes authenticate to the signing service with the Google identity token of the
service account they run as, read from the metadata server, so they must run on Google
Cloud. The signing service must list the relay's account as a caller with the `evm-relayer`
and `uma-asserter` roles: `evm-relayer` needs UMA `settleAssertion` and the adapter's
`close` and `publish`; `uma-asserter` needs the adapter's `assertEvidence` and
`assertSnapshot` and the bond token's `approve`. The challenger's account needs
`uma-challenger`, with UMA `disputeAssertion` and the bond token's `approve`.

## Test

```bash
cd ../../packages/optimistic-oracle/evm && forge build
pnpm --filter @eox/uma-relay test
```

The Anvil tests are skipped when `anvil` or the Foundry build is missing. They post claims
built with `@eox/oracle-worker/protocol`, so they also check that the adapter accepts the
worker's encoding.

## Not built yet

- A deployment (systemd unit or Cloud Run) and its service account.
- Fetching the signed Wormhole message and delivering it to the Solana receiver.
- Challenger checks of a claim's digests and of snapshot claims (see Challenging).
