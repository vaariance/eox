# Reference reader handoff

`src/references.ts` exposes `ReferenceReader(program)` and
`decodeReferenceAccount(program, name, accountInfo)` alongside the existing worker.
Use the checked-in `packages/oracle/idl/eox_oracle.json` to construct Anchor's
`Program`. The IDL supplies account discriminators, field order and Borsh layouts.
No SDK package or API service is introduced.

## Read operations

- `readSnapshot(address?)` reads a published snapshot, defaulting to the registry's
  latest accepted address. It returns indices, WORLD, baseline values, references,
  confidence, stored flags and identity/commitment metadata.
- `readCountry(countryIndex, address?)` returns the existing `IndexReference` shape.
- `readPair(snapshotAddress, baseIndex, quoteIndex)` executes the existing read-only
  Solana `readPair` instruction through the supplied provider's simulation method.
  This preserves Rust/on-chain arithmetic rather than implementing a second formula.
- `decodeReferenceAccount` checks the program owner and IDL discriminator; the
  reader additionally checks registry, epoch and snapshot PDAs, published status,
  completed calculation and baseline identity/value consistency.

All account reads use finalized commitment. Historical reads follow the snapshot's
own epoch; they do not use the worker's currently configured methodology. The
latest pointer is read once per request. A newer publication during that request
can leave the response one version behind, but does not mix versions. Pending work
never replaces the accepted pointer.

Fixed-point values are signed integer strings at scale `1000000`. Epoch IDs,
sequence numbers, counts and Unix-second timestamps are also strings to preserve
integer precision. Indices and baselines are not USDC prices. Country order is the
epoch's two-letter country roster, not alphabetical order.

Run the wallet-free account example from the repository root:

```sh
pnpm --filter @eox/oracle-worker exec tsx examples/read-reference.ts <RPC URL> [snapshot address]
```

The example constructs a connection-only provider. Pair reads additionally require
an Anchor provider implementing `simulate`; the existing `SolanaTransport` provides
this and delegates both its country and pair methods to the reader. No transaction
is submitted by these read methods.

## Current chain account layouts

The checked-in IDL and program are authoritative. Each account starts with its
8-byte Anchor discriminator, followed by the listed fields in order. `key` is a
32-byte Solana public key; hashes are 32 bytes. Borsh vectors use a little-endian
u32 count; integers are little-endian; bool occupies one byte. Accounts may contain
unused allocation padding after the encoded value.

| Account | Ordered fields after discriminator |
| --- | --- |
| Registry | authority:key, adapter:key, paused:bool, active:key, latest:key, next_sequence:u64, history_digest:hash |
| Epoch | registry:key, id:u64, countries:vec<[u8;2]>, indicator_counts:vec<u8>, multiplier:u16, configuration_digest:hash, rule_pages:u16, sealed:bool, baseline:vec<i64>, baseline_world:i64, baseline_snapshot:key |
| RulePage | epoch:key, country:u8, page:u8, rules:vec<vec<u8>> |
| Snapshot | registry:key, epoch:key, sequence:u64, cutoff:i64, predecessor:key, adapter:key, status:u8, frozen_pages:u16, calculated_pages:u16, evidence_digest:hash, precommitment:hash, postcommitment:hash, deadline:i64, evaluation_time:i64, published_at:i64, event_digest:hash, event_count:u64, pending:u32, closed:bool, countries:vec<CountryOutput>, world:i64, world_confidence:i64 |
| EvidencePage | snapshot:key, country:u8, page:u8, frozen:bool, calculated:bool, slots:vec<vec<u8>> |
| EvidenceHistory | digest:hash, pending:u32, rejected:u32, invalid:bool |
| Challenge | snapshot:key, evidence:hash, id:hash, outcome:u8 |

`CountryOutput` fields, in order: normalized_sum:i128, confidence_sum:i128,
weight_sum:u64, complete:bool, state:i64, confidence:i64, saturated:bool,
stale:bool, ratio:i64, change:i64, expressed:i64, reference_confidence:i64.
The sums are calculation accumulators, not displayed index values.

Snapshot status tags 0–7 are draft, precommitted, postcommitted, calculating,
published, rejected, cancelled and expired. Challenge outcome tags are 0 pending,
1 evidence upheld, 2 evidence invalid. Page indices group eight indicators.
Rule and slot byte vectors use the existing `src/codec.ts` and Rust math schemas.

PDA seeds are `registry`; `epoch` + id:u64; `snapshot` + epoch:key + sequence:u64;
`rules` + epoch:key + country:u8 + page:u8; `page` + snapshot:key + country:u8 +
page:u8; `history` + evidence digest; `challenge` + challenge ID.

## Publication event and API mapping

`ReferencePublished` has its IDL discriminator followed by snapshot:key, epoch:key,
sequence:u64, evidence_cutoff:i64, evaluation_time:i64, postcommitment:hash.
Anchor `EventParser(program.programId, program.coder)` decodes it from transaction
logs. `AdapterInconsistency` contains snapshot:key and challenge:[u8;32]. An event
alone does not prove transaction success or finality; Joel's indexer must check both.
The event has no publication timestamp; fetch the published snapshot's `published_at`.

For `@eox/app-api`, map snapshot address to `snapshotId`, baseline snapshot address
to `baselineId`, and `configurationDigest` to the on-chain configuration identity.
Do not present that configuration hash as the portable methodology manifest digest.
Convert integer strings to API number fields only after checking safe-integer bounds.

The accounts do not store the portable manifest digest, transaction signature,
source publication timestamps, UMA IDs, Wormhole receipts or executable-image ID.
An API must obtain these from verified indexed records, not manufacture them from
other hashes. The snapshot exposes separate evidence, precommitment, postcommitment
and challenge-event commitments; they are not interchangeable.

`stale` and `saturated` are stored per-country calculation flags. WORLD has no stored
stale/saturation flags. API-level reference age and execution eligibility require
Joel's explicit status policy and incident information; the reader does not infer
those or authorize execution. Publication signature requires transaction indexing.

The current accounts use the simulated adapter signer and its local deadline.
Authenticated UMA assertion registration, actual assertion deadlines and relay
acceptance remain P2. These readers do not turn the current adapter into verified UMA.
