# Continuous oracle integration contract v1

This is the task #1 handoff for `product.md` §8.3–8.4. Godwin consumes the
claim and relay formats below. Joel consumes the [account layouts and reference
readers](../../apps/oracle-worker/REFERENCE-READERS.md). These codecs do not
authenticate relay messages or change the deployed program. Authenticated
acceptance, receipt storage and lifecycle enforcement are task #2.

Implementations: [TypeScript](../../apps/oracle-worker/src/protocol.ts) and
[Rust](crates/math/src/protocol.rs). The existing worker package exports
`@eox/oracle-worker/protocol` and `@eox/oracle-worker/references`.

## Encoding and identity

All fields below are encoded in the listed order using Borsh. Integers are
unsigned little-endian. `hash` and Solana public keys are fixed 32 raw bytes;
EVM addresses are fixed 20 raw bytes, without string or vector prefixes. A bool
is one byte, 0 or 1. An option is tag 0 for absent, or tag 1 followed by its value.
A vector starts with a u32 element count. A string starts with its u32 UTF-8 byte
length. Record IDs must contain 1–256 UTF-8 bytes. JSON u64 inputs use canonical
unsigned decimal strings; byte arrays use integers 0–255. No address casing,
Unicode normalization, sorting or rounding is performed by an encoder.

Every commitment is SHA-256 of the concatenation:

```text
UTF8("EOX/ORACLE/V1\0") || u32LE(domain byte length) || UTF8(domain) || Borsh(payload)
```

The zero following V1 is a single NUL byte. Domains are:

| Payload | Domain |
| --- | --- |
| EvidenceClaim | continuous-evidence-claim-v1 |
| SnapshotClaim | continuous-snapshot-claim-v1 |
| RelayMessage | continuous-relay-v1 |
| Required assertion set | continuous-assertion-set-v1 |
| Event history step | continuous-event-history-v1 |

`ClaimContext` fields are: version:u16 (=1), evm_chain_id:u64,
adapter:address, solana_program:key, registry:key, epoch:u64,
methodology_manifest:hash, configuration_digest:hash, evidence_policy:hash.

The methodology manifest is the portable policy artifact commitment. The
configuration digest is the existing epoch's on-chain configuration commitment.
The evidence-policy hash identifies the immutable admission policy. None is an
executable-image ID. `evidence_digest` is the portable observation identity;
`metadata_digest` binds its metadata; `assessment_digest` identifies the separate
confidence assertion. Preserve original artifact hashes and source record IDs.

Deployment means the program and registry in their configured Solana network.
These bytes do not contain a genesis hash. Task #2 must pin a distinct source
adapter/emitter per destination network and reject foreign deployments; identical
program/PDA addresses alone cannot distinguish devnet from mainnet. EVM chain IDs
and Wormhole chain IDs are different namespaces and must be checked separately.

## Claims

`EvidenceClaim` fields: context:ClaimContext, evidence_digest:hash,
metadata_digest:hash, record_id:string, artifact_digests:vec<hash>,
assessment_digest:hash, provenance_digests:vec<hash>.

Each artifact/provenance list has 1–64 entries, in strictly ascending raw-byte
order without duplicates. The assertion means the observation and assessment
satisfy the identified evidence policy and have the committed source support.
Encoding does not prove artifact availability, assessment truth or admission.

`EvidenceBinding` fields: record_id:string, evidence_digest:hash,
assessment_digest:hash, assertion_id:hash.

`ClaimSlot` fields: country:u8, indicator:u8, current:EvidenceBinding,
comparison:option<EvidenceBinding>.

`SnapshotClaim` fields: context:ClaimContext, proposal:key, precommitment:hash,
predecessor:option<key>, cutoff:u64, slots:vec<ClaimSlot>,
evidence_assertions:vec<hash>.

Proposal is the snapshot account address. Predecessor is the published snapshot
address, absent for the initial proposal. Cutoff and all other wire timestamps
are nonnegative Unix seconds; integration with today's i64 chain timestamps must
reject out-of-range values. Slots have 1–960 entries ordered strictly by country
then indicator index. Country indices are 0–29 and indicators 0–31 in the pinned
epoch configuration. The consumer must additionally enforce that every required
configured slot exists and that comparison selections meet methodology rules.

The evidence assertion list has 1–1920 sorted unique IDs and must equal the set
used by the slot bindings. Identical bindings may be reused; one assertion ID
cannot identify conflicting records or assessments. The snapshot assertion means
this complete selection follows the methodology's cutoff, revision and comparison
rules. It does not assert a payout or include its own returned UMA assertion ID.

Request evidence assertions first, freeze their returned IDs into the snapshot
claim, then register exactly one snapshot assertion. Persist that returned ID
separately. Reuse settled-true evidence only when evidence, assessment, policy,
epoch and deployment context are unchanged. A new proposal has a new snapshot
claim but may reference those original evidence receipts. Do not manufacture new
dispute history for reuse.

## Relay messages

`RelayMessage` fields: header:RelayHeader, event:RelayEvent.

`RelayHeader` fields: version:u16 (=1), evm_chain_id:u64, wormhole_chain:u16,
adapter:address, solana_program:key, registry:key, epoch:u64, proposal:key,
precommitment:hash, event_number:u64.

Event numbers start at 1 per proposal. `RelayEvent` begins with its u8 variant
tag, followed by these ordered fields:

| Tag / kind | Fields |
| --- | --- |
| 0 Registered | uma:address, assertion_id:hash, claim_kind:u8, claim_digest:hash, subject:hash, start:u64, deadline:u64 |
| 1 Disputed | assertion_id:hash, subject:hash, dispute_id:hash |
| 2 Settled | assertion_id:hash, subject:hash, accepted:bool, disputed:bool, settled_at:u64 |
| 3 Closed | assertion_set_digest:hash, event_count:u64, event_digest:hash, accepted:bool |

`claim_kind` is 0 Evidence or 1 Snapshot. For both kinds, `subject` is the
registered claim digest, unchanged in later messages. An evidence subject is
therefore its full evidence-claim commitment, not just the portable observation
digest. A snapshot subject is its snapshot-claim commitment; its proposal address
is separately bound in the header. Start and deadline are the authenticated UMA
values and must differ by exactly 3,600 seconds. Dispute identity comes from the
authenticated adapter record, not a relay-generated random ID.

The required assertion set payload is `vec<hash>(sorted evidence assertion IDs)`
followed by `hash(snapshot assertion ID)`. The latter must not occur in the former.
This is how closure commits the snapshot assertion without a self-referential claim.

Event history begins with 32 zero bytes. For each non-closure event in proposal
event-number order, hash `previous_history:hash || relay_message_digest:hash`
under the event-history domain. Closure carries that final history and count;
its own event number must be count + 1. Closure is excluded from the history it
commits. Duplicate delivery must not increment the count or append a hash again.
Reused evidence remains linked to its original authenticated receipts; do not
rewrite those messages with a new proposal header. The receiver must validate
that reuse context before counting the assertion as satisfied for the new proposal.

The future receiver must verify Wormhole authentication, pinned emitters/UMA,
registration-to-claim bindings, event order, deduplication, settlement timing and
outcomes. Accepted closure requires every required assertion settled true;
rejection follows a required false outcome. Unknown or unresolved assertions
cannot become accepted through elapsed time. The encoders validate structure;
they do not establish these stateful conditions.

## Vectors and compatibility

[protocol-v1.json](fixtures/protocol-v1.json) contains example inputs, exact hex
bytes and expected commitment hex for every claim/message kind. It includes
initial and reused-evidence snapshots, separately registered snapshot assertion,
accepted closure, and an alternative false settlement. Addresses and receipt IDs
are synthetic; this is an encoding corpus, not a live UMA transcript. The
comparison registration uses an illustrative claim hash rather than a second
source dataset. Event history contains only the named accepted-path messages.

Both languages test against this same file. Run Rust with
`cargo test --manifest-path packages/oracle/Cargo.toml -p eox-oracle-math -p eox-oracle-cli`
and worker tests with `pnpm --filter @eox/oracle-worker test`.

These continuous formats are incompatible with the existing annual `EOXR` relay
format and annual receiver. Do not route them to it or reinterpret an annual
result as a per-proposal closure. Existing simulated-adapter instructions and
account layouts are unchanged by this handoff.
