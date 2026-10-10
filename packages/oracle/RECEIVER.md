# Continuous authenticated receiver

This implements the authenticated-receiver portion of Peter's product step 6.
The continuous program accepts task #1 claims and relay messages; it does not
route them through the annual settlement receiver. Local verification is separate
from deployment and live Wormhole delivery.

## Configuration and compatibility

An administrator creates a `ReceiverConfig` containing the Wormhole core program,
source EVM chain, Wormhole chain, adapter, emitter, UMA contract, consistency level,
schema version, methodology manifest and evidence policy. The sealed epoch's
configuration digest remains its separate identity. The first configuration pins
manifest and evidence policy in an immutable `EpochAuthentication`; later receiver
configurations for that epoch cannot change those identities.

Pin one receiver while a snapshot is Draft. This creates its companion account
and replaces its simulated adapter with the companion's program-derived address.
An external signer cannot impersonate that address. The legacy precommit
instruction rejects it; simulated register/resolve/close instructions cannot
satisfy the signer requirement. Use `precommit_authenticated`, which freezes the
existing evidence commitment without inventing a local challenge deadline.

Existing registry, epoch, snapshot, evidence and publication-event layouts remain
unchanged. Published history remains readable with the existing reference reader.
The existing fixture CLI remains explicitly simulated; authenticated helpers are
available separately in the worker package.

## Claim and receipt flow

1. Upload evidence claim bytes in chunks of at most 512 bytes, then seal. Claims
   have a 4,800-byte limit and are checked against the pinned context and exact
   task #1 Borsh/SHA-256 commitment. Identical upload retries are harmless;
   changed bytes at an existing offset are rejected.
2. Receive and apply evidence assertion registrations. Build the snapshot claim
   incrementally from frozen slots, one current/comparison binding per instruction.
   Validate record identity, portable evidence digest, metadata digest, source
   artifact and registered claim. Bindings commit the assessment digest. UMA's
   attestation is responsible for the assessment's provenance and truth; the
   program does not independently establish either.
3. Append each used evidence assertion ID once in sorted order. A serialized
   105-byte SHA-256 state preserves exact task #1 encoding without loading the
   entire snapshot claim into the SBF heap. Seal the resulting snapshot claim.
4. Register exactly one snapshot assertion. Its returned ID is appended only to
   the closure set, not its own claim. Reuse original settled-true evidence receipts
   under the same pinned receiver/context; do not fabricate new dispute history.
5. Deliver posted-VAA accounts to `receive_relay`. It reads the actual account
   owner and checks the configured core program, `vaa` prefix, version,
   consistency level, emitter and all continuous message bindings. Incoming
   messages are stored by proposal/event number and may arrive out of order.
6. Apply receipts in contiguous event order. The global assertion PDA uses source
   EVM chain, UMA contract and assertion ID, preventing a configuration change
   from counting the same evidence dispute twice. Registration carries the actual
   one-hour UMA deadline. Settlements before that deadline are rejected.
7. Audit each required evidence assertion as settled true. Accept closure only
   after all required evidence assertions and the snapshot assertion are true,
   with matching assertion-set commitment and ordered event count/hash. A false
   evidence outcome invalidates its stable evidence history; a false snapshot
   outcome rejects selection without attributing guilt to individual records.
8. Use the existing postcommit, paged calculation and publish instructions.
   Publication rechecks predecessor and the challenge history committed at
   postcommit. A changed history requires expiration/cancellation and a fresh
   proposal; partially calculated results never become the latest reference.

`AuthenticatedProposal.applied_events` includes closure for ordering. Snapshot
`event_count` and `event_digest` describe the non-closure history committed by
closure. Identical deliveries do not append that history or repeat penalties.

## New account layouts

All accounts use Anchor discriminators and Borsh. Ordered fields below follow
`programs/eox-oracle/src/authenticated.rs`; public keys and hashes are 32 bytes.
The generated IDL is the machine-readable layout. These accounts supplement the
[existing account layouts](../../apps/oracle-worker/REFERENCE-READERS.md).

| Account | Ordered fields after discriminator |
| --- | --- |
| EpochAuthentication | epoch:key, methodology_manifest:hash, evidence_policy:hash |
| ReceiverConfig | registry:key, epoch:key, id:u64, settings:ReceiverSettings |
| AuthenticatedProposal | snapshot:key, receiver:key, started:bool, frozen:bool, incident:bool, slot_cursor:u16, comparison_next:bool, unique_assertions:u32, appended_assertions:u32, audited_assertions:u32, last_assertion:hash, claim_hash:vec<u8>, set_hash:vec<u8>, claim_digest:hash, snapshot_assertion:hash, assertion_set_digest:hash, snapshot_accepted:bool, applied_events:u64, event_digest:hash |
| AuthenticatedClaim | receiver:key, digest:hash, sealed:bool, bytes:vec<u8> |
| AuthenticatedAssertion | receiver:key, id:hash, claim_digest:hash, evidence_digest:hash, snapshot:bool, start:u64, deadline:u64, disputed:bool, dispute_id:hash, outcome:u8 |
| AssertionMembership | proposal:key, assertion:key, used:bool, appended:bool, audited:bool |
| BoundClaim | digest:hash |
| AuthenticatedRelayReceipt | proposal:key, event_number:u64, digest:hash, wormhole_sequence:u64, applied:bool, bytes:vec<u8> |

`ReceiverSettings` order: wormhole_program:key, evm_chain_id:u64,
wormhole_chain:u16, emitter:hash, adapter:[u8;20], uma:[u8;20],
consistency_level:u8, schema_version:u16, methodology_manifest:hash,
evidence_policy:hash. Assertion outcomes are 0 unresolved, 1 true, 2 false.
Receipt/membership `proposal` points to the authenticated companion account;
its `snapshot` field identifies the actual snapshot.

`AuthenticatedIncident` emits snapshot:key, event_number:u64, expected:hash,
received:hash. Inspect the persisted incident and registry pause after a successful
transaction: success means an incident was recorded, not that acceptance occurred.

## Incidents and trust boundary

Conflicting authenticated messages persist an incident, pause publication, and
latch the registry adapter to the empty key. The instruction returns success so
these changes are not rolled back. Ordinary `set_pause(false)` cannot clear this
latch. This slice deliberately provides no incident-recovery override; recovery
requires a separately reviewed administrative migration or program change. It
must not be described as an implemented automatic recovery flow.

Late events cannot rewrite published outputs. Proof transport is permissionless:
its payer pays fees but has no authority to assign outcomes. Guardian verification
is performed by the pinned Wormhole core program; tests that inject core-owned
account bytes exercise the receiving trust boundary, not guardian signatures.
The wire destination lacks a genesis hash, so deployment must pin network-specific
source adapter/emitter identities and the intended Wormhole consistency policy.

Reference layouts follow Wormhole's [posted-VAA account](https://github.com/wormhole-foundation/wormhole/blob/main/solana/bridge/program/src/accounts/posted_vaa.rs)
and [message fields](https://github.com/wormhole-foundation/wormhole/blob/main/solana/bridge/program/src/accounts/posted_message.rs).

## Worker handoff and verification

Use [the authenticated worker helpers](../../apps/oracle-worker/AUTHENTICATED-RECEIVER.md)
for instruction building, bounded uploads, finalized-state probes and durable
restart recovery. The existing worker package exports these helpers; no new SDK,
HTTP service, signer, relay daemon or deployment is included.

The source-time decision is separate: `EOX/PUBLICATION/V2` now admits OECD/BIS
first-observed times and floors PortWatch milliseconds, as approved in
`product.md` §8.7. Economic arithmetic and exact source-value precision are unchanged.

Runtime verification results are recorded after the compiled-program test run.
