#!/bin/bash
set -euo pipefail

project="${GCP_PROJECT:-colosseum-eox}"
zone="${GCP_ZONE:-europe-west1-b}"
instance="${GCP_INSTANCE:-eox-dev}"

repo_root="$(git rev-parse --show-toplevel)"
app="$repo_root/apps/cox-monitor"
commit="$(git -C "$repo_root" rev-parse --short HEAD)"
if [ -n "$(git -C "$repo_root" status --porcelain -- apps/cox-monitor packages/price-feeds)" ]; then
  echo "refusing to deploy: apps/cox-monitor or packages/price-feeds has uncommitted changes" >&2
  exit 1
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
esbuild="$(cd "$app" && node -e "
  const { createRequire } = require('node:module');
  const path = require('node:path');
  const fromTsx = createRequire(require.resolve('tsx/package.json', { paths: [process.cwd()] }));
  console.log(path.join(path.dirname(fromTsx.resolve('esbuild/package.json')), 'bin', 'esbuild'));
")"
(cd "$app" && "$esbuild" src/main.ts --bundle --platform=node --format=esm --target=node22 --outfile="$workdir/monitor.mjs" --log-level=warning)
cp "$app/deploy/cox-monitor.service" "$workdir/cox-monitor.service"

gcloud_args=(--project="$project" --zone="$zone" --quiet)
gcloud compute scp "$workdir/monitor.mjs" "$workdir/cox-monitor.service" "$instance:/tmp/" "${gcloud_args[@]}"
gcloud compute ssh "$instance" "${gcloud_args[@]}" --command "
  set -e
  id cox-monitor >/dev/null 2>&1 || sudo useradd --system --home-dir /var/lib/cox-monitor --shell /usr/sbin/nologin cox-monitor
  sudo install -d -m 0755 /opt/cox-monitor/releases/$commit
  sudo install -m 0644 /tmp/monitor.mjs /opt/cox-monitor/releases/$commit/monitor.mjs
  sudo ln -sfn /opt/cox-monitor/releases/$commit /opt/cox-monitor/current
  sudo install -m 0644 /tmp/cox-monitor.service /etc/systemd/system/cox-monitor.service
  rm -f /tmp/monitor.mjs /tmp/cox-monitor.service
  sudo systemctl daemon-reload
  sudo systemctl enable cox-monitor >/dev/null
  sudo systemctl restart cox-monitor
  for attempt in \$(seq 1 30); do
    curl -fsS http://127.0.0.1:8792/health && echo && exit 0
    sleep 1
  done
  sudo journalctl -u cox-monitor -n 40 --no-pager >&2
  exit 1
"
