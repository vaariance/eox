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

`Relay` takes a `Sender` (`address`, `send(transaction)`). Tests use a local Anvil key.
The deployed service must use Joel's remote signer with the `evm-relayer` role and never a
local key (`product.md` §8.14).

## Test

```bash
cd ../../packages/optimistic-oracle/evm && forge build
pnpm --filter @eox/uma-relay test
```

The Anvil tests are skipped when `anvil` or the Foundry build is missing. They post claims
built with `@eox/oracle-worker/protocol`, so they also check that the adapter accepts the
worker's encoding.

## Not built yet

- The process entry point and its configuration.
- The remote-signer `Sender`.
- Fetching the signed Wormhole message and delivering it to the Solana receiver.
- The challenger.
