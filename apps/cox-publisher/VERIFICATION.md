# P4 local verification — 11 October 2026

Status: implementation and local verification ready for review. The publisher
is disabled and has not been installed or started on the dev VM. P4's running
service milestone is not complete. No live signing, account initialization,
publication, deployment, commit or push occurred in this work.

| Check | Result |
| --- | --- |
| Publisher archive, configuration, journal, scheduler, transport and disabled CLI | 64 tests pass |
| Publisher strict TypeScript check | Pass |
| COX generated-IDL client | 9 tests pass |
| COX methodology and P1 wire vectors | 13 tests pass |
| COX Rust workspace | 20 tests pass |
| Existing compiled SBF program with real classic SPL token transfers | 15 tests pass |
| Frozen workspace lockfile and dependency supply-chain policy | Pass, 617 entries |
| Retired EOX caller search | No executable imports remain |
| Preserved ignored-file inventory during cleanup | Identical before/after, 21,371 entries |

The transport tests use generated Anchor IDL/account layouts, P3 account
fixtures, and real Ed25519 signatures. RPC and signer services are controlled
test doubles; they do not establish live Cloud Run authorization or devnet
publishing. They cover unsigned-before-sign and signed-before-broadcast
persistence, lost responses, byte-identical retries, finalized success/failure,
blockhash expiry, expiry/status races, corrupt signatures, cached-byte checking,
network/build/key/mint identity, stale cursor/phase/sequence, pauses, and vault
surplus/shortfall. Scheduler tests cover missed origin, missed later minutes,
restart, repeated safety scans and accepted work continuing beyond a minute.
Archive tests verify all 30 asset hashes, exact prices, fallback policy,
Bybit conversion evidence, roster order, deadlines, artifact integrity and
bounded concurrent artifact retrieval.

The compiled SBF lifecycle suite is a separate rerun of P3, covering custody,
reservations, withdrawals during accepted work, aggregate capacity rejection,
refunds, pauses, restart and delayed execution. No program source or deployed
build was changed by P4. This does not claim an end-to-end publisher-to-devnet
run, a Linux service shutdown proof, or measured live throughput. The Linux
service and enabled CLI use the same operating-system lock with `--no-fork`;
the disabled CLI smoke test runs locally without network or lock acquisition.

## Remaining before the P4 running-service milestone

- Initialize registry, seal the actual methodology and create the test pool.
- Configure the real pool, digest, origin and roster; startup must precede origin.
- Complete Joel's signer binding, caller identity access and runtime funding.
  The current adapter obtains the attached VM identity from metadata. Deployment
  must make the authorized publisher service-account identity available there;
  another owner's VM identity must not be silently substituted.
- Install and exercise the Linux service on the dev VM, then record actual
  finalized publication/crank recovery and execution capacity. Live activation
  requires its inputs to be ready. P5's 24-hour acceptance run remains separate.

The archive must supply the exact sealed roster and its corresponding P1 digest.
If the feed check reduces the roster, Joel's archive must support that version;
P4 never filters a 30-asset snapshot and relabels its hash as a subset.
