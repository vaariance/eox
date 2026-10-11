# COX publisher

The publisher advances the COX Solana program from archived minute prices through publication, evaluation, aggregate safety checks, execution and finalization. It uses a remote KMS signing service and keeps a durable transaction journal for recovery.

This runtime targets Solana devnet and classic SPL test collateral. It consumes the price archive rather than querying exchanges directly. Pool creation, methodology sealing, administration and wallet trades are separate operations.

## Requirements and startup

Use Linux with Node.js 24 or later, `flock`, installed workspace dependencies and synchronized system time. Enabled operation requires a configured archive API, devnet RPC, authorized Google workload identity and funded runtime authority.

From the repository root:

```sh
pnpm --filter @eox/cox-publisher build
pnpm --filter @eox/cox-publisher test
pnpm --filter @eox/cox-publisher start --config /etc/cox-publisher/dev.json
```

The default [`config/dev.json`](config/dev.json) is a disabled template. Disabled startup exits before acquiring a lock or contacting the network. `--once` runs one processing tick for controlled verification.

## Configuration

Configuration is strict JSON: every declared field is required and unknown fields are rejected.

| Fields | Purpose |
| --- | --- |
| `enabled` | Enables network activity and processing. |
| `rpcUrl`, `archiveUrl` | Solana RPC and archived-price API endpoints. |
| `signerUrl`, `signerAudience` | Remote signer endpoint and Google identity-token audience. |
| `statePath` | Absolute path to the durable journal. |
| `poolId`, `methodologyDigest`, `origin` | Pool number, sealed methodology digest and minute-aligned Unix-second origin; required when enabled. Integer identities are decimal strings. |
| `assets`, `bybit` | Canonical asset ordering and venue policy matching the sealed methodology. |
| `runtimeAuthority`, `genesisHash`, `signerNetwork`, `keyVersion` | Pinned devnet authority, network and KMS identity. |
| `computeUnitLimit`, `computeUnitPriceMicroLamports` | Transaction compute budget. |
| `pollMs`, `retryMaxMs` | Polling interval and bounded retry delay. |

The program ID is `G6iQGoupNSfduw1QJxQ9vcVi9FnCC6cbippXsi4QQzJF`. The full devnet genesis hash is checked independently of the signer's shortened network identifier. Startup requires the deployment record's executable hash to match [`publisher-build.json`](../../packages/cox/deploy/publisher-build.json), then verifies the actual deployed program bytes, pool, methodology, signer identity and custody state. A mismatched build blocks processing rather than assuming the required storage layout is deployed.

Signer authentication obtains an access token from Google Compute Engine metadata, then calls IAM `generateIdToken` for `cox-publisher@colosseum-eox.iam.gserviceaccount.com`, with the configured audience and `includeEmail: true`. The VM service account needs permission to generate that identity token; the dedicated publisher identity needs signer invocation permission and the configured `oracle-operator` role. No service-account key file is required. Private wallet keys are never configuration inputs. Store authenticated RPC URLs in protected runtime files, outside version control.

## Publication and execution rules

A snapshot must be archived by cutoff +30 seconds and accepted by cutoff +55 seconds. Acceptance fixes the prices and execution values. Accepted requests have no fill deadline: an unfinished batch blocks the next publication until finalization. A restart, pause or missed minute does not reprice accepted work. Request expiry is evaluated against the accepted batch.

An uninitialized pool needs batch 0 during its origin window. Missing that window requires a new methodology and pool. An initialized pool skips missed minutes instead of replaying late snapshots. The archive snapshot must match the sealed asset roster exactly; the publisher cannot filter or reorder it locally.

Compute budgets are limited to 1,400,000 units and 1,000 micro-lamports per unit. Network confirmation and batch completion time depend on actual chain conditions and request volume; the one-minute publication interval is not a fill guarantee.

## Recovery and operations

The journal records exact unsigned and signed bytes. Recovery reconciles finalized chain state before rebuilding transactions. Preserve the journal and its directory across restarts and deployments. Deleting the journal to clear a retry can destroy the information needed to avoid duplicate submissions.

The program reuses one batch and one publication account per pool. Before processing can overwrite the latest publication, the publisher preserves its finalized 8 KB account bytes in `${statePath}.history/<sequence>.json`. Each record binds the program, pool, network, sequence, batch, account hash, state digest and finalized slot. The history writer checks the previous state-digest link and rejects gaps or conflicting records. Preserve this directory together with the journal; the on-chain latest account cannot reconstruct overwritten history.

The [backup service](../../deploy/dev/cox-publisher-backup.service) and [timer](../../deploy/dev/cox-publisher-backup.timer) upload publication history and journal versions to a private Cloud Storage bucket every minute. Uploads use content-addressed object names, create-only writes and checksum verification. This asynchronous backup can lag local state; it is not a substitute for the local archive-before-overwrite check. Restore using an authorized reader identity, verify the history chain and journal identity, and reconcile finalized state before resuming. Never run two publishers during recovery.

Enabled CLI invocation automatically acquires `${statePath}.flock`. Only one publisher may operate a pool. `--locked` is an internal flag for a process already protected by the outer lock. Do not invoke it directly or remove a lock path while a publisher runs. A leftover lock file is harmless after the process exits.

[`deploy/dev/cox-publisher.service`](../../deploy/dev/cox-publisher.service) provides a systemd template with a dedicated user, restricted writable directories and automatic restart. Installed release paths may differ from the template. Use the [deployment guide](../../deploy/dev/README.md) for installation, journal backup and recovery procedures.

```sh
sudo systemctl status cox-publisher
sudo journalctl -u cox-publisher -f
```

Logs report processing outcomes, timings and failures. The service has no public HTTP API. See [verification notes](VERIFICATION.md) for test scope and the [COX specification](../../packages/cox/SPEC.md) for protocol rules.
