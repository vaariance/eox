# Dev server

A single Compute Engine VM running the evidence store (Postgres 16 via docker
compose) and the six ingestion pipelines on a daily cron.

| | |
|---|---|
| Project | `colosseum-eox` |
| Instance | `eox-dev`, `us-central1-a`, e2-small, Debian 12 |
| Postgres | `127.0.0.1:5433` on the VM only, never exposed publicly |
| Ingests | daily 06:00 UTC as system user `eox`, log in `/opt/eox/logs/ingest.log` |
| Evidence API | systemd `eox-evidence-api`, `127.0.0.1:8787` on the VM only, logs via `journalctl -u eox-evidence-api` |

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
`-L 8787:localhost:8787` to reach the evidence API as well):

```bash
gcloud compute ssh eox-dev --account=$GCP_ACCOUNT --project=colosseum-eox --zone=us-central1-a -- -L 5434:localhost:5433 -N
gcloud compute ssh eox-dev --account=$GCP_ACCOUNT --project=colosseum-eox --zone=us-central1-a --command "sudo cat /opt/eox/.env"
```

## Recreate the VM

```bash
gcloud services enable compute.googleapis.com --account=$GCP_ACCOUNT --project=colosseum-eox
gcloud compute instances create eox-dev --zone=us-central1-a --machine-type=e2-small \
  --image-family=debian-12 --image-project=debian-cloud --boot-disk-size=20GB \
  --boot-disk-type=pd-balanced --labels=env=dev,app=eox \
  --account=$GCP_ACCOUNT --project=colosseum-eox
GCP_ACCOUNT=$GCP_ACCOUNT deploy/dev/deploy.sh
```

`setup.sh` installs Docker, the compose plugin and Node 22 when they are
missing, so the first deploy to a fresh VM needs no manual steps.
