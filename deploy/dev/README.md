# Dev server

A single Compute Engine VM running the evidence store (Postgres 16 via docker
compose) and the six ingestion pipelines on an hourly cron.

| | |
|---|---|
| Project | `colosseum-eox` |
| Instance | `eox-dev`, `us-central1-a`, e2-small, Debian 12 |
| Postgres | `127.0.0.1:5433` on the VM only, never exposed publicly |
| Ingests | hourly at :05 UTC as system user `eox`; each job holds its own lock in `/opt/eox/locks` (a run still in progress is skipped, not doubled) and is stopped after 50 minutes; log in `/opt/eox/logs/ingest.log` |
| Evidence API | systemd `eox-evidence-api`, `127.0.0.1:8787` on the VM only, logs via `journalctl -u eox-evidence-api` |
| App API (fixture) | systemd `eox-app-api`, `127.0.0.1:8790` on the VM only; logs via `journalctl -u eox-app-api` |
| App API (live) | systemd `eox-app-api-live`, `127.0.0.1:8791` on the VM only; reads finalized `eox-oracle` publications on Solana devnet and evidence readiness from the evidence API; state in `/opt/eox/state/app-api-live`; logs via `journalctl -u eox-app-api-live` |
| Backups | daily 05:30 UTC to `gs://colosseum-eox-db-backups`, kept 30 days, log in `/opt/eox/logs/backup.log` |
| Service account | `eox-dev-vm`, which can only create objects in the backup bucket |

## Layout on the VM

| Path | Contents |
|---|---|
| `/opt/eox/app` | `git archive` of the deployed commit (no git clone, no GitHub credentials) |
| `/opt/eox/.env` | `POSTGRES_PASSWORD` and `DATABASE_URL`, mode 600, generated on first deploy and kept afterwards |
| `/opt/eox/run-ingests.sh` | runs all six ingests, used by cron |
| `/opt/eox/DEPLOYED_COMMIT` | short hash of the deployed commit |

## Deploy

Deploys the committed `HEAD`; uncommitted changes are not included. Postgres
data and the generated password survive redeploys.

```bash
GCP_ACCOUNT=you@example.com deploy/dev/deploy.sh
```

Optional overrides: `GCP_PROJECT` (default `colosseum-eox`), `GCP_ZONE`
(default `us-central1-a`), `GCP_INSTANCE` (default `eox-dev`). Always pass the
account explicitly: the active gcloud configuration may point at a different
project.

## Connect

Open a tunnel, then use `localhost:5434` with the password from the VM (add
`-L 8787:localhost:8787` for the evidence API, `-L 8790:localhost:8790` for the fixture app API and
`-L 8791:localhost:8791` for the live app API):

```bash
gcloud compute ssh eox-dev --account=$GCP_ACCOUNT --project=colosseum-eox --zone=us-central1-a -- -L 5434:localhost:5433 -N
gcloud compute ssh eox-dev --account=$GCP_ACCOUNT --project=colosseum-eox --zone=us-central1-a --command "sudo cat /opt/eox/.env"
```

## Private RPC for the live app API

The live app API uses the public devnet RPC unless `/opt/eox/app-api-live.env`
exists. That file is never in the repo; it holds the private RPC URL (which
contains the provider's API key) and overrides the unit's defaults:

```bash
gcloud compute ssh eox-dev --account=$GCP_ACCOUNT --project=colosseum-eox --zone=us-central1-a --   'read -rs -p "RPC URL: " url && echo && sudo install -m 600 -o eox -g eox /dev/null /opt/eox/app-api-live.env    && printf "SOLANA_RPC_URL=%s
SOLANA_RPC_INTERVAL_MS=200
" "$url" | sudo tee /opt/eox/app-api-live.env >/dev/null    && sudo systemctl restart eox-app-api-live'
```

The URL is read without echo, so it stays out of shell history and logs.

## Backups and restore

`backup-db.sh` runs `pg_dump --format=custom`, checks the archive with
`pg_restore --list`, and uploads it as `eox-<UTC timestamp>.dump` through the
Storage JSON API with `ifGenerationMatch=0`, so an existing backup is never
overwritten. It verifies the uploaded MD5 against the local file. The last
three days of dumps also stay in `/opt/eox/backups` on the VM.

The VM's service account can create backups but cannot read, overwrite or
delete them; the bucket deletes objects after 30 days. Restore with an account
that can read the bucket:

```bash
gcloud storage ls gs://colosseum-eox-db-backups/ --account=$GCP_ACCOUNT --project=colosseum-eox
gcloud storage cp gs://colosseum-eox-db-backups/eox-<stamp>.dump . --account=$GCP_ACCOUNT --project=colosseum-eox
createdb -h localhost -p 5433 -U eox eox_restore
pg_restore -h localhost -p 5433 -U eox -d eox_restore --no-owner eox-<stamp>.dump
```

Restoring into a fresh database also restores the append-only triggers. Never
restore over the live `eox` database; point `DATABASE_URL` at the restored one.

## Recreate the VM

```bash
gcloud services enable compute.googleapis.com storage.googleapis.com iam.googleapis.com --account=$GCP_ACCOUNT --project=colosseum-eox
gcloud storage buckets create gs://colosseum-eox-db-backups --location=us-central1 \
  --uniform-bucket-level-access --public-access-prevention --account=$GCP_ACCOUNT --project=colosseum-eox
gcloud storage buckets update gs://colosseum-eox-db-backups --lifecycle-file=deploy/dev/backup-lifecycle.json \
  --account=$GCP_ACCOUNT --project=colosseum-eox
gcloud iam service-accounts create eox-dev-vm --account=$GCP_ACCOUNT --project=colosseum-eox
gcloud storage buckets add-iam-policy-binding gs://colosseum-eox-db-backups \
  --member=serviceAccount:eox-dev-vm@colosseum-eox.iam.gserviceaccount.com \
  --role=roles/storage.objectCreator --account=$GCP_ACCOUNT --project=colosseum-eox
gcloud compute instances create eox-dev --zone=us-central1-a --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=20GB \
  --boot-disk-type=pd-balanced --labels=env=dev,app=eox \
  --service-account=eox-dev-vm@colosseum-eox.iam.gserviceaccount.com --scopes=cloud-platform \
  --account=$GCP_ACCOUNT --project=colosseum-eox
GCP_ACCOUNT=$GCP_ACCOUNT deploy/dev/deploy.sh
```

`setup.sh` installs Docker, the compose plugin and Node 22 when they are
missing, so the first deploy to a fresh VM needs no manual steps.
