# P4 local verification — 11 October 2026

Status: implementation and local verification ready for review. The publisher
is disabled and has not been installed or started on the dev VM. P4's running
service milestone is not complete. No live signing, account initialization, publication, deployment, commit or push
occurred in this work. A later funding action transferred 1 devnet SOL to the
runtime account; see `packages/cox/deploy/runtime-funding-devnet.json`.

| Check | Result |
| --- | --- |
| Publisher archive, configuration, journal, scheduler, transport, identity and disabled CLI | 77 tests pass |
| Publisher strict TypeScript check | Pass |
| COX generated-IDL client | 11 tests pass |
| COX methodology and P1 wire vectors | 13 tests pass |
| COX Rust workspace | 20 tests pass |
| Replacement rolling-storage SBF with real classic SPL token transfers | 16 tests pass |
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

The compiled SBF lifecycle suite extends P3 with repeated storage reuse and covers custody,
reservations, withdrawals during accepted work, aggregate capacity rejection,
refunds, pauses, restart and delayed execution. The later rolling-storage revision changes program source and rebuilds SBF;
the deployed build is unchanged. This does not claim an end-to-end publisher-to-devnet
run, a Linux service shutdown proof, or measured live throughput. The Linux
service and enabled CLI use the same operating-system lock with `--no-fork`;
the disabled CLI smoke test runs locally without network or lock acquisition.

## Remaining before the P4 running-service milestone

- Initialize registry, seal the actual methodology and create the test pool.
- Configure the real pool, digest, origin and roster; startup must precede origin.
- Complete Joel's signer binding, caller identity access and runtime funding.
  The adapter now reads VM access credentials from metadata and impersonates
  `cox-publisher@colosseum-eox.iam.gserviceaccount.com` through IAM
  `generateIdToken`, including its email. Joel reports the permission is ready;
  local tests verify the exact flow and failures, not a live VM invocation.
- Install and exercise the Linux service on the dev VM, then record actual
  finalized publication/crank recovery and execution capacity. Live activation
  requires its inputs to be ready. P5's 24-hour acceptance run remains separate.

The archive must supply the exact sealed roster and its corresponding P1 digest.
If the feed check reduces the roster, Joel's archive must support that version;
P4 never filters a 30-asset snapshot and relabels its hash as a subset.

## Rolling storage verified; deployment pending

Peter approved one latest publication and one reusable batch per pool. Both
8,192-byte accounts now retain their addresses and lamports through repeated
compiled-program publications. This caps their current devnet rent deposit at
0.0845312 SOL for the pair, rather than adding that amount every minute. Other
accounts and fees are additional. The old deployed build still allocates new
accounts; no savings are live until the approved upgrade is deployed.

The full finalized publication is durably archived before signing or
rebroadcasting subsequent work. Tests cover immutable complete bytes,
predecessor chain, idempotency, corrupt records, gaps, write failure, restart,
coherent reads and archive failures blocking signing/rebroadcast. The new build
is pinned by deploy/publisher-build.json, and enabled startup rejects the old
deployment record. The signer must adopt fixed schema-2 batch/publication
addresses. Backup/restore and live integration remain activation requirements.

See packages/cox/ROLLING-STORAGE-HANDOFF.md for the release contract, measured
allocation/compute and prepared binary hash. No active-pool migration is provided.

## Installed VM verification — 11 October 2026

The isolated publisher service and minute backup timer are installed and enabled
on `eox-dev`. All 77 publisher tests and strict TypeScript checking pass under
Node.js 24.21.0. Startup validates the actual deployed executable, sealed pool
and signer identity. Clock synchronization, waiting-state restart recovery and
process exclusivity were checked. A private-bucket upload/download test restored
68,261 bytes with identical SHA-256; the real waiting-state journal is backed up.
See `deploy/dev/COX-PUBLISHER.md` and
`packages/cox/deploy/publisher-running-devnet.json`.

This supersedes the installation and backup prerequisites described above.
At verification time the service was waiting for pool 0's origin, 08:00 UTC /
09:00 Lagos on 11 October. First publication, transaction-policy acceptance and
the continuous live observation run remain unverified. The nine-hour feed waiver
and deferred full trading-batch archive remain unchanged.
