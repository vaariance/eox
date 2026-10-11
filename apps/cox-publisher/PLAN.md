# P4 publisher implementation

Peter authorized implementation on 11 October 2026. Live signing and live-pool
activation remain disabled until the on-chain setup and Joel's signer access
are ready. Existing P3 reports are outside this change.

- [x] Implement typed archive admission against the sealed roster and P1 hashes.
- [x] Implement persistent scheduling and all P3 execution phases, with no fill deadline.
- [x] Integrate finalized Solana reads, unsigned builders and the existing remote signer.
- [x] Persist transaction bytes before sending; reconcile before resending or rebuilding.
- [x] Verify pauses, missed minutes, ambiguous submission, expiry and restart recovery.
- [x] Prepare disabled dev-VM service/configuration and document activation prerequisites.
- [x] Audit remaining Peter-owned EOX callers and remove only retired replacements separately.
- [x] Run focused tests and type checking; publish verification and request commit approval.

The chain is authoritative. Process an accepted batch before selecting another
cutoff. Inspect phase/cursor and monotonic safety state after every confirmed
transaction; never infer a fill from elapsed time or a local journal entry.
The publisher uses only archived evidence, classic SPL test collateral and
the existing KMS runtime identity. It never calls an exchange or accepts a
wallet file. No new registry, pool or methodology is created by the runtime.

Local implementation is verified; P4 deployment/activation remains pending the
on-chain setup and authorized signer. See VERIFICATION.md. Commit approval is
still required; no change has been staged or committed by this work.
