# Development infrastructure

Scripts and systemd templates for a Solana devnet deployment on a Debian Compute
Engine VM. The shared deployment runs PostgreSQL, the price archiver, evidence
API, fixture app API and live app API. Publisher and monitor installations are
separate from the shared deployment. The signing service runs on Cloud Run;
the RPC proxy runs on Cloudflare Workers.

The supplied defaults target project `colosseum-eox`, instance `eox-dev`, zone
`europe-west1-b`. These are deployment defaults, not credentials or a public API
contract. Database and service endpoints bind to localhost; use SSH tunnels for
operator access.

## Services

| Unit | Endpoint or role |
| --- | --- |
| `eox-evidence-api` | Evidence API, `127.0.0.1:8787` |
| `cox-app-api` | Synthetic fixture API, `127.0.0.1:8790` |
| `cox-app-api-live` | Devnet-backed app API, `127.0.0.1:8791` |
| `cox-publication-archive-copy.timer` | Every 30 s, copies new publisher archive records for the live API (read-only on the publisher side, never overwrites) |
| `cox-archiver` | One-minute venue snapshot archive |
| `cox-publisher` | Snapshot publication and batch execution; installed separately |
| `cox-monitor` | Archive verdicts, `127.0.0.1:8792`; installed separately |

PostgreSQL 16 runs in Docker on host port 5433. Live API configuration and
transaction state are separate from the fixture service. A service reporting
`active` establishes process status, not successful publications or wallet fills.

## Shared service deployment

Prerequisites: authenticated Google Cloud CLI, SSH access, permissions to update
the VM and its backup bucket, and a reviewed commit containing the intended
release. From the repository root:

```sh
GCP_ACCOUNT=operator@example.com deploy/dev/deploy.sh
```

The script archives committed `HEAD`; uncommitted files are excluded. Overrides:
`GCP_PROJECT`, `GCP_ZONE`, `GCP_INSTANCE` and `GCP_BACKUP_BUCKET`. Select the cloud
account explicitly. This is a deployment action: it replaces the shared release,
runs migrations and restarts its managed services. It does not deploy the Solana
program, Cloud Run signer, Cloudflare proxy or independently installed monitor.
The publisher unit is supplied as a template and requires its own installation.

`setup.sh` installs Docker and Node.js 22 when missing, then pnpm 11.18.0.
Components that require Node.js 24, including the publisher, need a separately
provisioned compatible runtime. Do not assume shared VM setup satisfies those
components' runtime requirements.

## Files and credentials

| Path | Purpose |
| --- | --- |
| `/opt/eox/app` | Committed shared-service release |
| `/opt/eox/DEPLOYED_COMMIT` | Shared release identity |
| `/opt/eox/.env` | Database credentials, mode 0600 |
| `/opt/eox/cox-app-api-live.env` | Live API configuration and RPC URLs |
| `/opt/eox/state/cox-app-api-live` | Persisted live API state |
| `/opt/eox/state/cox-publication-archive` | Copied publication archive, read by the live API |
| `/opt/eox/runtime/node-v24.21.0-linux-x64` | Checksum-pinned Node 24 for both app APIs (`@cox/client` needs Node 24) |
| `/opt/eox/logs/backup.log` | Database backup log |
| `/etc/cox-publisher/dev.json` | Private publisher configuration, when installed |
| `/var/lib/cox-publisher` | Publisher journal and recovery state |
| `/var/lib/cox-monitor/state.json` | Monitor progress and verdicts |

RPC URLs may contain credentials in their path or query. Store them in private
runtime configuration and avoid printing complete URLs. Keep the database off
the public internet. The publisher uses Google metadata credentials and IAM
identity-token generation for its dedicated caller identity; no runtime signing
key file belongs on the VM.

## Status and logs

Connect in the Cloud Console's VM SSH interface, or use:

```sh
gcloud compute ssh eox-dev --account="$GCP_ACCOUNT" --project=colosseum-eox --zone=europe-west1-b
```

Then inspect services and follow their logs:

```sh
systemctl list-units 'cox-*' 'eox-*' --type=service --all
sudo journalctl -u cox-publisher -f
sudo journalctl -u cox-archiver -n 50 --no-pager
sudo journalctl -u cox-app-api-live -n 50 --no-pager
sudo journalctl -u cox-monitor -n 50 --no-pager
```

Ctrl+C stops log viewing without stopping the service. Check an installed
publisher backup timer with `systemctl list-timers --all`. Preserve state across
restarts; deleting journals to clear retries can lose transaction recovery.

## Local access through SSH

Forward only the ports needed for the task:

```sh
gcloud compute ssh eox-dev --account="$GCP_ACCOUNT" --project=colosseum-eox --zone=europe-west1-b -- -L 5434:localhost:5433 -L 8787:localhost:8787 -L 8791:localhost:8791 -N
```

The database is then reachable on local port 5434, evidence API on 8787 and live
app API on 8791. Retrieve credentials through an authorized private channel;
do not paste database environment files into logs or public issue reports.

## Database backups and restore

`backup-db.sh` runs daily at 05:30 UTC under the service user. It creates a
custom-format `pg_dump`, validates it with `pg_restore --list`, uploads through
the Storage JSON API with `ifGenerationMatch=0` and checks the uploaded checksum.
Local dumps are retained for three days. The default private bucket is
`gs://colosseum-eox-db-backups`, with a 30-day lifecycle.

The VM service account has create-only bucket access. Restore with a separate
operator identity that can read backups, into a new database:

```sh
gcloud storage ls gs://colosseum-eox-db-backups/ --account="$GCP_ACCOUNT" --project=colosseum-eox
gcloud storage cp gs://colosseum-eox-db-backups/eox-<stamp>.dump . --account="$GCP_ACCOUNT" --project=colosseum-eox
createdb -h localhost -p 5433 -U eox eox_restore
pg_restore -h localhost -p 5433 -U eox -d eox_restore --no-owner eox-<stamp>.dump
```

Set database authentication privately. Never restore over the active database;
validate the restored data and append-only triggers before changing service
connections. Database backups do not automatically cover publisher journals,
publication archives or monitor state. Those require separate backup and restore procedures.

## Publisher archive backups

The publisher's complete finalized publication files live at
`/var/lib/cox-publisher/state.json.history/<sequence>.json`. Preserve these
alongside the journal. The archive gate requires durable local history before
an on-chain publication can be replaced. The archive is separate from source
price evidence and does not preserve the full historical trading batch.

`cox-publisher-backup.timer` invokes [cox-publication-backup.ts](cox-publication-backup.ts)
every minute. Its configured private bucket is
`gs://colosseum-cox-publication-archives-dev`; journal and publication objects
have SHA-256 names under `pool-0/`. Uploads use create-only access and generation
preconditions; local markers avoid repeated uploads. No automatic expiration is
specified for this archive bucket. Check timer and upload failures:

```sh
systemctl status cox-publisher-backup.timer
sudo journalctl -u cox-publisher-backup -n 30 --no-pager
```

Offsite backup is asynchronous: a VM failure can lose files not yet uploaded.
Restore with an authorized operator identity into a separate directory first.
Verify each file's SHA-256 against its object name and validate sequence,
predecessor, program/pool identity and state digests. Select a coherent journal
and history set. Stop the publisher before installing a validated restore,
preserve restrictive ownership and permissions, then restart for finalized-chain
reconciliation. Never overwrite live recovery files while the service runs.

## Separate components

- [Publisher configuration and recovery](../../apps/cox-publisher/README.md)
- [Monitor deployment](../../apps/cox-monitor/README.md)
- [App API configuration](../../apps/app-api/README.md)
- [Signer deployment and authentication](../../apps/signer/README.md)
- [RPC proxy deployment](../../apps/rpc-proxy/README.md)
- [Solana program deployment](../../packages/cox/deploy/README.md)
