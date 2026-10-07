# Oracle worker

This package consumes an oracle-owned `EvidenceProvider`. It does not import ingestion or access the evidence-store database. The fixture provider is the only shipped provider.

`SolanaTransport` sends real Anchor transactions and reads finalized accounts. It never falls back to a fake chain. Worker tests use an explicitly named simulated transport; those tests are not evidence of Solana execution.

## Local fixture and preview

From the repository root, after installing workspace dependencies and building the Rust preview binary:

```sh
pnpm --filter @eox/oracle-worker oracle fixture --math-fixture ../../packages/oracle/fixtures/baseline.json --out /tmp/eox-fixture
pnpm --filter @eox/oracle-worker oracle preview --config /tmp/eox-fixture/config.json --fixture /tmp/eox-fixture/stream.json --binary ../../packages/oracle/target/debug/eox-oracle
pnpm --filter @eox/oracle-worker oracle serve-artifacts --fixture /tmp/eox-fixture/stream.json
```

`fixture` preserves synthetic source offsets but rebases publication timestamps to the current time, so fixtures do not claim future releases on devnet. `--time` makes generation deterministic. Artifact bytes are explicitly synthetic and served read-only on localhost.

## Real Solana execution

Build/deploy the Anchor program first and use its generated IDL. Every command below takes:

```text
--rpc <RPC URL> --idl <generated IDL path> --wallet <authority keypair JSON>
--config /tmp/eox-fixture/config.json --state /tmp/eox-worker-state
```

- `init --adapter <separate adapter public key>` initializes the registry and immutable epoch configuration. Existing account contents are checked before resuming configuration.
- `run --fixture /tmp/eox-fixture/stream.json` starts continuous processing. `--once` makes a single tick. A fresh proposal starts after the five-second collection period.
- `inspect` reads the latest finalized snapshot; `--snapshot <address>` reads a historical/proposed snapshot.
- `country --country US` reads the latest finalized country/WORLD reference; optionally supply `--snapshot` for a historical one.
- `challenge --adapter-wallet <separate keypair> --snapshot <address> --action register --id <64 hex characters> --country 0 --page 0 --index 0` registers a simulated UMA challenge under the trusted devnet signer.
- `challenge ... --action upheld|invalid --id <same ID>` resolves that challenge.
- `challenge ... --action close` explicitly attests closure after the 60-second window, checking the on-chain event count and digest. The worker never signs or synthesizes closure itself.
- `pair --snapshot <published address> --base 0 --quote 1` simulates the read-only pair instruction and decodes its result into exact fixed-point integer strings.

Before closing a window the adapter operator must account for every test challenge. This is a **trusted simulation of dispute delivery**, not authenticated UMA bridging.

Append new immutable rows and change IDs to `stream.json` to introduce updates. Never rewrite consumed change history. Corrections use a new record identity. The fixture cursor detects rewritten prefixes, and artifact retrieval verifies SHA-256.

## Recovery and notifications

Keep the whole state directory. The journal atomically stores cursor advancement together with queued records; proposal-to-PDA bindings are flushed before transaction submission. Retries inspect finalized accounts. Rejected changes remain quarantined, and the previous accepted reference remains available.

Only one worker may use a journal. A PID lock prevents concurrent writers; a lock whose process no longer exists can be reclaimed. A filesystem journal is appropriate for one devnet process, not distributed production workers.

Successful publication writes a durable history before emitting a JSON notification. Notifications are not an exactly-once delivery service: a crash between the durable write and stdout can suppress an emission. Consumers needing replay must read journal publication history or finalized chain accounts and deduplicate by snapshot address.

Source-publication time is mandatory for this version. Live integration must settle a freshness policy for missing publication times rather than copying ingestion time into that field.

Run `pnpm --filter @eox/oracle-worker build` and `pnpm --filter @eox/oracle-worker test` for type checking and fixture/recovery tests. Economic outputs are index values, not USDC redemption entitlements.
