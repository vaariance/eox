# EOX oracle program

Experimental devnet program. Index outputs are not USDC prices or redemption
entitlements. Dispute authenticity relies on a distinct configured test signer.

## Account addresses

All integer seeds use little-endian bytes. Country and page indices use one byte.

| Account | Seeds |
| --- | --- |
| Registry | `registry` |
| Epoch | `epoch`, epoch ID (`u64`) |
| Rule page | `rules`, epoch address, country index, page index |
| Snapshot | `snapshot`, epoch address, global sequence (`u64`) |
| Evidence page | `page`, snapshot address, country index, page index |
| Evidence history | `history`, canonical evidence digest |
| Challenge receipt | `challenge`, globally unique challenge ID |

Rules, evidence, and slots are supplied as canonical Borsh bytes from
`eox-oracle-math`. Byte vectors keep the Anchor IDL independent of external Rust
type metadata. The program deserializes and validates them; these are not opaque
trusted calculation outputs.

## Submission and acceptance

The authority creates an epoch, appends rules in country/page/slot order, and
seals it. The configuration digest includes this ordering and cannot change.

The registry permits one active proposal. Creating one consumes `next_sequence`,
including proposals later rejected or cancelled. Workers must read that counter.
Upload slots by explicit index. Identical retries are accepted, conflicting
retries fail. Freeze pages in country/page order, then precommit. Precommit sets
an on-chain deadline 60 seconds later. It does not publish a reference.

Initialize a history account for every distinct evidence digest before challenge
registration or calculation. Challenge IDs are globally deduplicated: the same
external event cannot be applied again against a later proposal. Registration proves the evidence occurs in an
uploaded page and requires the pinned adapter signature. All challenges must be
resolved before closure. Closure attests the exact ordered event count and
digest; passage of time is insufficient.

An invalid outcome rejects the entire proposal. It does not release the active
proposal until remaining challenges resolve and the adapter closes the window.
This preserves globally pending evidence history. Replaying an old rejected
closure cannot release a newer proposal.

Postcommitment includes the original commitment, evidence digest, proposal event
digest, global challenge-history digest, and chain evaluation time. This binds
retained history even when evidence is reused from an earlier proposal.

## Calculation and publication

Calculate pages in country/page order. Remaining accounts must be each slot's
current evidence history, followed by its comparison history when present, in
slot order. They must be owned by this program and match the evidence-derived
PDA. Invalid or still-pending evidence cannot calculate.

Page computation adds exact weighted sums. The final page for each country
rounds once and finalizes the country. Publication computes WORLD and references,
fixes the first epoch baseline, and atomically updates the registry pointer.

The last finalized reference remains available during a subsequent proposal.
Every publication must match the latest predecessor. Calculation and publication
expire one hour after postcommitment. Expiry never implies acceptance.

`read_pair` accepts two country indices and returns Borsh `math::Reference` via
Solana return data. Both country states and baseline values come from the same
epoch. The multiplied result may be negative.

## Simulation limits

This program authenticates the configured adapter, not UMA itself. Late
contradictory resolutions pause the registry and emit an inconsistency event;
published history is unchanged. Challenge registration must reach Solana before
the proposal deadline; a source-side timestamp cannot extend this devnet delivery
window. Resolution may arrive after the deadline. The administrator can explicitly unpause after
investigation. No production bridge is implied.

The account and instruction bound tests are host checks. An SBF build and actual
runtime tests are additionally required to establish compute budgets and
maximum-universe execution; passing host checks does not establish those facts.
