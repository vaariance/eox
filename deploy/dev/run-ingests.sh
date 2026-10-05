#!/bin/bash
set -uo pipefail
set -a
. /opt/eox/.env
set +a
cd /opt/eox/app
status=0
for script in container-throughput policy-rate residential-property-price unemployment-rate core-cpi gdp-real-volume; do
  echo "[$(date -u +%FT%TZ)] ingest:$script"
  pnpm --filter @eox/ingestion "ingest:$script" || {
    echo "[$(date -u +%FT%TZ)] ingest:$script FAILED"
    status=1
  }
done
exit $status
