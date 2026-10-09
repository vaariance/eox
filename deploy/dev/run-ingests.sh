#!/bin/bash
set -uo pipefail
set -a
. /opt/eox/.env
set +a
cd /opt/eox/app
mkdir -p /opt/eox/locks
status=0
for script in container-throughput policy-rate residential-property-price unemployment-rate core-cpi gdp-real-volume; do
  lock="/opt/eox/locks/ingest-${script}.lock"
  echo "[$(date -u +%FT%TZ)] ingest:$script"
  flock --nonblock --conflict-exit-code 75 "$lock" timeout 50m pnpm --filter @eox/ingestion "ingest:$script"
  code=$?
  if [ "$code" -eq 75 ]; then
    echo "[$(date -u +%FT%TZ)] ingest:$script SKIPPED: previous run still in progress"
  elif [ "$code" -ne 0 ]; then
    echo "[$(date -u +%FT%TZ)] ingest:$script FAILED with exit code $code"
    status=1
  fi
done
exit $status
