# COX integration handoff

P3 targets Solana devnet and classic SPL six-decimal test collateral. Program
deployment and live-pool activation are separate. A deployed program does not
mean a sealed live methodology, active pool or running publisher exists.

## Price archive encoding correction for Joel

`packages/cox/SPEC.md` section 3 and `fixtures/vectors.json` are authoritative.
The Rust P2 encoder and Godwin's monitor already match those vectors. The
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

Joel must version the archive correction and serve authoritative digests before
the P4 publisher consumes them. Existing append-only observations and payloads
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

## Legacy dependencies retained until their replacements land

The audit is for this `dev` checkout; recheck after integration with
`origin/main`. No Joel or Godwin component was changed to force deletion.

| Retained legacy material | Current caller or carry-over requirement |
| --- | --- |
| `apps/oracle-worker/src/references.ts`, `types.ts` and EOX IDL | Joel's app API live source, Solana reader and tests |
| Economic `packages/oracle/crates/math`, CLI, baseline/us-improves fixtures and artifact list | Joel's app API fixture generator and provenance checks |
| `packages/methodology` | Joel's evidence facts and app API readiness |
| Worker `journal.ts`, `retry.ts`, `solana.ts` and its `codec.ts` → `provider.ts`/`publication.ts` closure | P4 transport/recovery carry-over; retain the complete compiling closure until its COX replacement exists |

After the COX compiled lifecycle suite passed, Peter's retired EOX program,
receiver/protocol/streaming modules and tests, protocol fixtures, worker
proposal lifecycle, command/demo/preview entry points and their obsolete
exports/scripts were removed. The oracle Cargo workspace now builds only the
retained economic math and CLI. Retained EOX Rust tests (24), worker tests
(14) and worker type checking pass. The old deployed program is abandoned in
place. These deletions are prepared separately from the COX implementation
commit; see `research/deletion-audit.md`.

Papers and ignored sealed research remain preserved. The `eox-archive` Git
tag does not include ignored files. The surviving worker transport closure is
an explicit temporary dependency, not a new EOX publisher or live integration.
