#!/bin/bash
set -euo pipefail

archive="${1:?usage: setup.sh <archive.tar.gz> <commit>}"
commit="${2:?usage: setup.sh <archive.tar.gz> <commit>}"
pnpm_version="11.18.0"

if [ "$(id -u)" -ne 0 ]; then
  echo "setup.sh must run as root" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin nodejs >/dev/null
  corepack enable
fi

id eox >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/eox --shell /bin/bash eox
usermod -aG docker eox

rm -rf /opt/eox/app
mkdir -p /opt/eox/app /opt/eox/logs
tar xzf "$archive" -C /opt/eox/app

if [ ! -f /opt/eox/.env ]; then
  password="$(openssl rand -hex 24)"
  printf 'POSTGRES_PASSWORD=%s\nDATABASE_URL=postgres://eox:%s@127.0.0.1:5433/eox\n' "$password" "$password" > /opt/eox/.env
fi

install -m 0644 /opt/eox/app/deploy/dev/docker-compose.override.yml /opt/eox/app/docker-compose.override.yml
install -m 0755 /opt/eox/app/deploy/dev/run-ingests.sh /opt/eox/run-ingests.sh
chown -R eox:eox /opt/eox
chmod 600 /opt/eox/.env

sudo -u eox -H PNPM_VERSION="$pnpm_version" bash -c '
  set -euo pipefail
  cd /opt/eox/app
  docker compose --env-file /opt/eox/.env up -d
  until docker compose exec -T postgres pg_isready -U eox >/dev/null 2>&1; do sleep 2; done
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  corepack prepare "pnpm@$PNPM_VERSION" --activate >/dev/null
  pnpm install --frozen-lockfile
  set -a
  . /opt/eox/.env
  set +a
  pnpm db:migrate
'

echo "0 6 * * * /opt/eox/run-ingests.sh >> /opt/eox/logs/ingest.log 2>&1" | crontab -u eox -
install -m 0644 /opt/eox/app/deploy/dev/eox-evidence-api.service /etc/systemd/system/eox-evidence-api.service
systemctl daemon-reload
systemctl enable eox-evidence-api >/dev/null
systemctl restart eox-evidence-api
for attempt in $(seq 1 30); do
  curl -fsS http://127.0.0.1:8787/health >/dev/null 2>&1 && break
  if [ "$attempt" -eq 30 ]; then
    journalctl -u eox-evidence-api -n 40 --no-pager >&2
    exit 1
  fi
  sleep 1
done

echo "$commit" > /opt/eox/DEPLOYED_COMMIT
chown eox:eox /opt/eox/DEPLOYED_COMMIT

echo "deployed $commit"
ss -ltn | grep -E ':(5433|8787) '
