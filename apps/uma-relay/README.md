# uma-relay (Godwin)

Keeps `EoxContinuousAdapter` moving (`product.md` §8.4, §8.11, §8.12). It never creates
claims and never decides an outcome: UMA decides, the adapter records, this service
only sends the transactions anyone may send.

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

## State

`readState` and `writeState` keep the cursor, known proposals and in-flight transactions
in one JSON file, written atomically. The chain is the source of truth: a relay started
with an empty state rebuilds everything from `startBlock` and publishes nothing twice.

## Signing

`Relay` takes a `Sender` (`address`, `send(transaction, operation)`). `remoteSender` is the
one the service runs with: it builds an EIP-1559 transaction for the `evm-relayer` key from
Joel's signing service, asks the service to sign it, checks that the returned transaction
is the same one and recovers to that key, and broadcasts it. The request ID is derived from
the unsigned bytes, so a retry of the same bytes is idempotent and a rebuilt transaction is
a new request under the same operation ID (`settle:<assertion>`, `close:<proposal>`,
`publish:<proposal>:<event number>`). The service never holds a private key
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
| `SIGNER_AUDIENCE` | Identity-token audience | `SIGNER_URL` |
| `START_BLOCK` | Block the adapter was deployed in | `0` |
| `CONFIRMATIONS` | Blocks behind the head that events are read at | `2` |
| `TICK_SECONDS` | Pause between ticks | `30` |

It authenticates to the signing service with the Google identity token of the service
account it runs as, read from the metadata server, so it must run on Google Cloud. The
signing service must list that account as a caller with the `evm-relayer` role and bind
UMA `settleAssertion` and the adapter's `close` and `publish` for that role.

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
- The challenger.
