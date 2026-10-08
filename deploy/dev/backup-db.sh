#!/bin/bash
set -euo pipefail

bucket="${1:?usage: backup-db.sh <bucket-name>}"
if ! [[ "$bucket" =~ ^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$ ]]; then
  echo "invalid bucket name: $bucket" >&2
  exit 1
fi

local_dir=/opt/eox/backups
keep_local_days=3
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="eox-${stamp}.dump"
dump="${local_dir}/${name}"

mkdir -p "$local_dir"
cd /opt/eox/app

compose=(docker compose --env-file /opt/eox/.env)
"${compose[@]}" exec -T postgres pg_dump -U eox -d eox --format=custom > "${dump}.partial"
"${compose[@]}" exec -T postgres pg_restore --list < "${dump}.partial" > /dev/null
mv "${dump}.partial" "$dump"
sha256="$(sha256sum "$dump" | cut -d' ' -f1)"
size="$(stat -c %s "$dump")"

token="$(curl -fsS -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' |
  python3 -c 'import json, sys; print(json.load(sys.stdin)["access_token"])')"

response="$(curl -fsS -X POST \
  -H "Authorization: Bearer ${token}" \
  -H 'Content-Type: application/octet-stream' \
  --data-binary "@${dump}" \
  "https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&ifGenerationMatch=0&name=${name}")"

uploaded_md5="$(printf '%s' "$response" | python3 -c 'import json, sys; print(json.load(sys.stdin)["md5Hash"])')"
local_md5="$(openssl dgst -md5 -binary "$dump" | base64)"
if [ "$uploaded_md5" != "$local_md5" ]; then
  echo "upload checksum mismatch for ${name}: ${uploaded_md5} != ${local_md5}" >&2
  exit 1
fi

find "$local_dir" -name 'eox-*.dump' -mtime +"$keep_local_days" -delete
find "$local_dir" -name 'eox-*.dump.partial' -mmin +60 -delete
echo "[$(date -u +%FT%TZ)] backup ${name} ${size} bytes sha256 ${sha256} uploaded to gs://${bucket}"
