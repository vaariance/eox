# Authenticated receiver worker integration

`@eox/oracle-worker/authenticated` exports transaction builders and restart-safe
helpers for the continuous receiver. They use the existing Anchor provider; they
neither implement a signer nor authenticate a VAA themselves. Solana authenticates
posted accounts against the receiver configuration.

The existing `run` CLI and `SolanaTransport.advance` retain their simulated-adapter
workflow. They do not automatically select these helpers. Integrators explicitly
select `AuthenticatedClient` for proposals pinned to the authenticated receiver.
Do not run the simulated transport against such a proposal.

## Execution order

1. Create the immutable receiver using `AuthenticatedInstructions.createReceiver`.
   The registry authority signs configuration and proposal preparation.
2. Create the ordinary draft snapshot, then call `client.pinReceiver()` **before**
   pre-commitment. Upload/freeze economic evidence with the existing instructions.
3. Call `client.precommit()`. The authenticated proposal has no local acceptance
   timer; registration supplies the actual UMA assertion deadlines.
4. Call `client.uploadEvidenceClaim(claim)` for each evidence claim. The helper
   encodes task #1 bytes, uploads at most 512 bytes per transaction, then seals.
5. Godwin submits the matching evidence assertions and posts their authenticated
   registration messages. Call `client.receiveRelay(message, postedVaa)`, then
   `client.applyRelay(message)` in event-number order. Receipt delivery can be
   out of order; application must be contiguous.
6. Once the evidence assertions are registered, call
   `client.freezeSnapshotClaim(snapshotClaim, evidenceClaims)`. This binds one
   observation at a time in country/indicator/current/comparison order, appends
   the sorted unique evidence assertion IDs, and verifies the final claim hash
   against the task #1 TypeScript encoder. Reused evidence uses its existing
   authenticated assertion, not a new locally invented assertion ID.
7. Godwin asserts the resulting snapshot claim, registers its returned assertion
   ID separately, and relays disputes and settlements. No snapshot assertion ID
   is included in its own claim.
8. After every required evidence assertion is upheld, call
   `client.auditAssertions(snapshotClaim.evidence_assertions)`. Apply accepted
   closure only after the snapshot assertion is also upheld. Rejection does not
   permit publication.
9. Use the existing post-commit, calculate-page and publish instructions. Wait
   for finalized publication before announcing a new reference.

`AuthenticatedInstructions` also exposes individual bounded instructions for
custom scheduling. `ReceiverAddresses` derives configuration, proposal, claim,
assertion, membership, receipt, evidence-page and history addresses. Assertion
identity is global to the source EVM chain, UMA contract and assertion ID.

## Recovery and finality

Give each proposal its own journal path. `AuthenticatedProgress` writes the exact
instruction digest before submitting; the digest includes every account and its
privileges. It binds the file to the destination program, proposal and receiver.
Changed bytes under the same operation ID fail instead of silently replacing work.

All built-in probes read program-owned accounts at `finalized`. After a response
is lost, a restarted helper first checks the relevant stored bytes, cursor or
receipt before sending again. Identical claim chunks and relay deliveries are
idempotent on chain. Sequential snapshot bindings are skipped using the finalized
cursor. The journal uses the existing atomic-write, fsync and process-lock code.
Only one process should own a proposal journal. A complete operation whose
finalized state disappears stops with an error.

A confirmed transaction is insufficient: `AuthenticatedSender` requests finalized
confirmation and checks the finalized account predicate afterward. Journal
signatures are diagnostic; durable chain state decides completion. Custom users
of `AuthenticatedProgress.run` must supply a predicate that validates the exact
expected program-owned finalized state, and a submitter that waits for finality.

A conflicting authenticated message must reach the program so its incident and
publication pause persist. The relay helpers then stop with
`AuthenticatedReceiverIncident`; they do not treat a successful transaction as
proof of acceptance. Ordinary RPC errors propagate and can be retried with the
same proposal journal. A receipt is not an acceptance signal until applied.

The sender measures each legacy transaction against Solana's 1,232-byte limit.
This is a transaction size check, not a compute-budget measurement.

## Fixture example and limitations

See [the injected-provider example](examples/authenticated-receiver.ts). Provide
an Anchor `Program` with the generated receiver IDL and an existing transaction
provider. `packages/oracle/fixtures/protocol-v1.json` supplies deterministic wire
examples; those synthetic identities are not deployed addresses or valid VAAs.
Program tests inject posted-VAA accounts and do not demonstrate live guardian
verification. No deployment, HTTP API, remote signer or relay daemon is included.
