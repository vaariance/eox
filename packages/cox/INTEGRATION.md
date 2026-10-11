# COX integration handoff

The prepared rolling-storage upgrade changes batch/publication seeds and history
retention. Read [the new handoff](ROLLING-STORAGE-HANDOFF.md) before integrating.
It is not deployed; the deployment record below still describes the old build.

P3 targets Solana devnet and classic SPL six-decimal test collateral. Program
deployment and live-pool activation are separate. A deployed program does not
mean a sealed live methodology, active pool or running publisher exists.

The program is deployed on devnet at
`G6iQGoupNSfduw1QJxQ9vcVi9FnCC6cbippXsi4QQzJF`; see
`deploy/deployed-devnet.json` for the verified build, transaction and authorities.
The generated IDL, client, fixture accounts, hash vectors and allowlist are
ready for service/UI/monitor integration. Signer binding is still separate;
no registry, methodology, collateral mint or live pool was initialized by
deployment.

## Price archive encoding correction for Joel

`packages/cox/SPEC.md` section 3 and `fixtures/vectors.json` are authoritative.
The Rust P2 encoder and Godwin's monitor already match those vectors. The historical
provisional archive encoder reported in the 2026-10-10 COX price-evidence log
entry has a different layout. Matching domain text alone is insufficient.

| Field | P1 authoritative layout | Provisional archive layout |
| --- | --- | --- |
| Domain | u32 little-endian UTF-8 byte length, then domain bytes | raw domain bytes |
| Asset identifier | u32 little-endian UTF-8 byte length, then identifier bytes | u8 byte length, then identifier bytes |
| Candle start | u64 little-endian | i64 little-endian |
| Price | positive u64 little-endian; no presence flag | presence flag then i64 little-endian |
| Trade age | u16 little-endian | u32 little-endian |
| Snapshot | length-prefixed domain, cutoff u64, count u32, ordered raw 32-byte price digests | raw domain, cutoff i64, count u32, ordered digests |

Venue codes remain Kraken 0, Coinbase 1 and Bybit 2. Allowed step/venue pairs
are (1,0), (2,1), (3,2), (4,0). No stringified hexadecimal digest is hashed.

Joel implemented and versioned this correction in `3559f2e` (migration `011`).
The current archive serves `digestEncoding: "COX/WIRE/V1"`; P4 recomputes and
checks those exact P1 hashes. This resolves the historical mismatch above. Existing append-only observations and payloads
must remain intact. Historical provisional digests must not be silently
relabeled as `COX/WIRE/V1`; a new computed digest or explicit versioned adapter
can bind the original stored evidence. The COX program accepts only P1 bytes.
An inadmissible snapshot has no publishable optional/null price representation.

## Receipt root and state digest for Godwin

`fixtures/state-vectors.json` contains exact receipt bytes, each folded prefix
root, the empty root and the full state preimage/digest. The fixtures use
synthetic public-key bytes; they do not identify a deployed pool. Regenerate
with `node packages/cox-client/src/fixtures.ts` and verify with
`node --test packages/cox-client/test/wire.test.ts`.

The initial receipt root is SHA-256 of the length-prefixed
`COX/RECEIPTS/V1` domain. Each queue-ordered receipt folds
`SHA256(previous_root || request32 || status_u8 || minted_u128LE || proceeds_u64LE)`.
Existing status codes retain their values; `SafetyRejected` is appended as 4.
Cancelled queue tombstones are excluded. A rejection returns its reservation
and has zero minted units and proceeds. Receipt inclusion does not make an
executing batch spendable; readers must check the batch's finalization state.

The state digest binds program and pool, scheduled batch and successful
publication sequence separately, predecessor, sealed methodology, snapshot,
reference values, pre/post class balances, receipt counts/root and all four
custody categories. Godwin should reject a publication whose digest or custody
equality fails and report an incident without signing or changing chain state.

## Keys and signer binding

Runtime publishing uses the existing non-exportable KMS identity
`GNmM11ZMFqEu3FYewGNDunpSSJBw8KnkDxzCGpSbpGj6`. Admin and upgrade authority
remain separate from runtime publishing. The runtime identity may pay publication and permissionless crank fees. The
measured thirty-price packet is 1,122 bytes when runtime pays, or 1,218 bytes
with a separate payer, including compute-limit and priority-fee instructions.
Only `publish` requires runtime authority. The signer handoff allowlists
`publish`, `evaluate`, `safety`, `seal_evaluation`, `execute` and `finalize` so
P4 can use the existing service key to pay for approved batch work. The latter
five remain permissionless on chain. Admin, upgrades, wallet trades and token
transfers are excluded. This file does not enable Joel's signer; he must bind
the verified deployed address, approved pool accounts and reviewed fee limits.
Runtime work needs only the default 32 KiB heap. The one-time admin methodology
seal uses 256 KiB and is outside the runtime allowlist.

## P4 publisher and retired EOX dependencies

The local publisher implementation is in `apps/cox-publisher`. Its disabled
configuration and service template do not initialize accounts or enable signing.
It admits only complete archived P1 snapshots matching the sealed roster,
verifies linked artifact bytes, and uses the existing remote signer. Accepted
batches advance through evaluation, aggregate safety, preparation and finalization
without a fill deadline. Persisted transactions are verified and reconciled
against finalized chain state before replacement.

See `apps/cox-publisher/README.md` for setup and activation prerequisites and
`apps/cox-publisher/VERIFICATION.md` for the local evidence and limits. The
service is not yet installed or running on the dev VM. Registry, sealed
methodology, test pool, signer authorization and funding remain prerequisites.
The disabled template enables Bybit to follow Joel's 10 October J3 decision;
the actual sealed methodology must match before runtime startup.

After merging Joel's caller replacements and verifying P4 carry-over, the
remaining tracked EOX worker, methodology, economic math, CLI, IDL and fixtures
were removed. No executable import into those packages remains. The remote
`eox-archive` tag was verified before deletion. Papers and ignored research
remain intact. Joel's `apps/app-api/fixtures/oracle-preview.json` remains an
archived provenance artifact; its retired math-crate string is not a live import.
The old deployed EOX program remains abandoned in place. Cleanup is a separate
review/commit group from P4; see `research/deletion-audit.md`.
