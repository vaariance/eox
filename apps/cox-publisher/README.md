# COX publisher

Peter's P4 runtime consumes Joel's archived minute snapshots and advances the
deployed COX program through publication, evaluation, aggregate safety scans,
execution and finalization. It never calls exchanges, creates pools, holds a
private wallet key or changes accepted prices. Collateral remains test tokens.

The supplied `config/dev.json` is disabled. It deliberately has no pool,
methodology digest or origin. Building and testing this service does not
activate the live pool or configure Joel's signer.

## Activation

Before enabling the service:

1. Initialize the on-chain registry with the separate admin and existing KMS
   runtime authority. Upload and seal a methodology backed by the actual feed
   check; create the six-decimal classic SPL test pool and vault.
2. Put that pool ID, sealed methodology digest, canonical selected roster,
   minute-aligned origin and actual Bybit policy in the configuration. These
   values must match the on-chain accounts. Dropped feed-check failures remain
   dropped; do not reorder assets or substitute others.
3. Have Joel bind the deployed program and six publisher/crank instructions
   in the signer, authorize the publisher service account and fund the runtime
   account with devnet SOL. The identity must be available through VM metadata.
4. Check the archive is serving admissible P1 snapshots and synchronize the VM
   clock. Arrange startup before the methodology origin; set `enabled: true`
   only when these prerequisites are satisfied.

The deployment program address is
`G6iQGoupNSfduw1QJxQ9vcVi9FnCC6cbippXsi4QQzJF`. The full devnet genesis hash
is pinned separately from the signer's existing 32-character network identity.
Configuration accepts no wallet or private-key field and rejects unknown fields.
Both the signer URL and audience are pinned to the approved Cloud Run service.

## Timing and recovery

A snapshot must be archived by cutoff +30 seconds and accepted by cutoff +55
seconds. Acceptance fixes its prices and execution values. There is no fill
deadline. The publisher finishes an accepted batch before publishing another;
pauses, restarts and missed subsequent minutes never reprice accepted work.
Request expiry uses the accepted batch, rather than eventual fill time.

An uninitialized pool requires batch 0 during its origin acceptance window.
Missing that window requires a newly prepared methodology and pool; a publisher
cannot repair it by sending batch 1. Once initialized, missed minutes are
skipped without replaying late snapshots.

The durable state file records the exact unsigned and signed transaction bytes.
Restart recovery reconciles finalized chain state before rebuilding a
transaction. Preserve `/var/lib/cox-publisher/state.json` and its containing
directory across restarts and deployments; never delete them to clear a retry.
Signer request expiry and Solana blockhash expiry are distinct from trade expiry.

## Dev VM service

`deploy/dev/cox-publisher.service` is an installation template, not an installed
or enabled service. It expects Linux, Node.js 24, `flock`, the installed workspace
dependencies under `/opt/eox`, a dedicated `cox-publisher` user and configuration
at `/etc/cox-publisher/dev.json`. The VM identity must have Joel's permitted
signer role; authentication obtains an audience-bound identity token from
metadata rather than a stored credential.

The service executes:

```sh
/usr/bin/flock --nonblock --no-fork /var/lib/cox-publisher/state.json.flock /usr/bin/node --import /opt/eox/apps/cox-publisher/node_modules/tsx/dist/loader.mjs /opt/eox/apps/cox-publisher/src/main.ts --config /etc/cox-publisher/dev.json --locked
```

Enabled CLI invocation automatically starts a child under the same operating
system lock, `${statePath}.flock`. Disabled configuration exits before network
access or lock acquisition. `--locked` is an internal child flag for invocation
under the outer lock. Do not invoke it directly or remove a lock path while a
publisher is running. `flock` releases ownership when the process exits; a remaining lock
file is harmless and does not need deletion. Writable paths are restricted to
the state and runtime directories. No service installation or startup occurs
as part of this change.

Compute limits are explicit: at most 1,400,000 compute units per transaction and
1,000 micro-lamports per compute unit. The template uses a price of 1 and polls
once per second; retry delays are bounded at 30 seconds. These settings do not
claim a guaranteed network throughput or a one-minute batch completion time.

Run the package's test and build commands before review. Configuration tests
cover disabled startup, required activation identities, roster ordering,
numeric limits, pinned devnet/KMS identity and rejection of credential fields.

The disabled template has Bybit enabled, following Joel's J3 decision. The
sealed methodology must match. Archive snapshots must match the sealed roster
exactly: a reduced roster requires a corresponding archive snapshot and digest,
not local filtering of a 30-asset snapshot.

The authentication adapter uses the VM's attached service-account identity.
Deployment must make the authorized publisher identity available through
metadata; this template does not change the VM identity or grant permissions.
See `VERIFICATION.md` for local test evidence and remaining deployment work.
