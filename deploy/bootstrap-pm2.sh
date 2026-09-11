#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/niaiwo/ip-intelligence}"
REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/chinazhangsan999-crypto/IP-Intelligence-Service.git}"
BRANCH="${BRANCH:-main}"
IP_SERVICE_DOMAIN="${IP_SERVICE_DOMAIN:-ip.chinazhangsan.ccwu.cc}"
DATABASE_NAME="ip_intelligence"
DATABASE_USER="ip_service"
ENV_FILE="$APP_DIR/.env"

if ! command -v node >/dev/null || ! command -v npm >/dev/null || ! command -v pm2 >/dev/null; then
  echo 'Node.js, npm and PM2 must be installed before deployment.' >&2
  exit 1
fi
if ! command -v psql >/dev/null || ! sudo -n true; then
  echo 'PostgreSQL and passwordless sudo are required before deployment.' >&2
  exit 1
fi

if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
elif [ -e "$APP_DIR" ]; then
  echo "Refusing to use non-Git directory: $APP_DIR" >&2
  exit 1
else
  git clone --branch "$BRANCH" --depth 1 "$REPOSITORY_URL" "$APP_DIR"
fi

if [ ! -f "$ENV_FILE" ]; then
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$DATABASE_USER'" | grep -q 1; then
    echo 'Refusing to create a new environment file for an existing database role.' >&2
    exit 1
  fi
  if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DATABASE_NAME'" | grep -q 1; then
    echo 'Refusing to create a new environment file for an existing database.' >&2
    exit 1
  fi
  umask 077
  database_password="$(openssl rand -hex 24)"
  master_key="$(openssl rand -hex 32)"
  metrics_token="$(openssl rand -hex 32)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE $DATABASE_USER LOGIN PASSWORD '$database_password'"
  sudo -u postgres createdb -O "$DATABASE_USER" "$DATABASE_NAME"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=3101
LOG_LEVEL=info
IP_DATA_DIR=./data
IP_CONFIG_DIR=./config
IP_DATA_AUTO_UPDATE_ENABLED=1
IP_DATA_UPDATE_INTERVAL_HOURS=6
IP_DATA_UPDATE_STARTUP_DELAY_SECONDS=60
IP2PROXY_AUTO_UPDATE_ENABLED=0
IP2PROXY_UPDATE_INTERVAL_DAYS=7
DATABASE_URL=postgresql://$DATABASE_USER:$database_password@127.0.0.1:5432/$DATABASE_NAME
DATABASE_SSL_MODE=disable
DATABASE_POOL_MAX=10
CLIENT_SECRET_MASTER_KEY=$master_key
METRICS_ENABLED=1
METRICS_TOKEN=$metrics_token
PUBLIC_LOOKUP_ENABLED=1
PUBLIC_LOOKUP_RATE_LIMIT_PER_MINUTE=30
PUBLIC_TRUST_PROXY=1
EOF
  chmod 600 "$ENV_FILE"
fi

mkdir -p "$APP_DIR/data"
chmod 750 "$APP_DIR/data"
cd "$APP_DIR"
npm ci --omit=dev
npm run db:migrate
npm run data:update-dbip
npm run data:update-open

if pm2 describe ip-intelligence >/dev/null 2>&1; then
  pm2 restart ip-intelligence --update-env
else
  pm2 start npm --name ip-intelligence --cwd "$APP_DIR" -- start
fi
pm2 save

if ! sudo grep -Fq "$IP_SERVICE_DOMAIN {" /etc/caddy/Caddyfile; then
  printf '\n%s {\n    encode zstd gzip\n    reverse_proxy 127.0.0.1:3101\n}\n' "$IP_SERVICE_DOMAIN" | sudo tee -a /etc/caddy/Caddyfile >/dev/null
fi
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy

health_ready=0
for attempt in $(seq 1 15); do
  if curl --fail --silent --show-error http://127.0.0.1:3101/health >/dev/null; then
    health_ready=1
    break
  fi
  sleep 1
done
if [ "$health_ready" -ne 1 ]; then
  echo 'IP Intelligence Service did not become healthy within 15 seconds.' >&2
  pm2 logs ip-intelligence --lines 80 --nostream >&2 || true
  exit 1
fi
echo "IP Intelligence Service deployed at https://$IP_SERVICE_DOMAIN"
