#!/bin/bash
set -euo pipefail

account="${GCP_ACCOUNT:?set GCP_ACCOUNT to the gcloud account with access to the project}"
project="${GCP_PROJECT:-colosseum-eox}"
zone="${GCP_ZONE:-europe-west1-b}"
instance="${GCP_INSTANCE:-eox-dev}"
backup_bucket="${GCP_BACKUP_BUCKET:-colosseum-eox-db-backups}"

repo_root="$(git rev-parse --show-toplevel)"
commit="$(git -C "$repo_root" rev-parse --short HEAD)"
if [ -n "$(git -C "$repo_root" status --porcelain)" ]; then
  echo "warning: uncommitted changes are not deployed; deploying $commit" >&2
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
git -C "$repo_root" archive --format=tar.gz -o "$workdir/eox.tar.gz" HEAD

gcloud_args=(--account="$account" --project="$project" --zone="$zone" --quiet)
(cd "$workdir" && gcloud compute scp eox.tar.gz "$instance:/tmp/eox.tar.gz" "${gcloud_args[@]}")
gcloud compute ssh "$instance" "${gcloud_args[@]}" --command "
  set -e
  rm -rf /tmp/eox-deploy && mkdir -p /tmp/eox-deploy
  tar xzf /tmp/eox.tar.gz -C /tmp/eox-deploy deploy/dev/setup.sh
  sudo bash /tmp/eox-deploy/deploy/dev/setup.sh /tmp/eox.tar.gz $commit $backup_bucket
  rm -rf /tmp/eox-deploy /tmp/eox.tar.gz
"
