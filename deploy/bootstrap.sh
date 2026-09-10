#!/bin/sh
set -eu

APP_DIR=/opt/ip-intelligence
ARCHIVE=/tmp/ip-intelligence-deploy.tar.gz
ENV_FILE="$APP_DIR/deploy/.env.production"

install -d -m 0750 "$APP_DIR"
tar -xzf "$ARCHIVE" -C "$APP_DIR"
chmod 0750 "$APP_DIR/deploy"
chmod 0750 "$APP_DIR/data"
chown -R 1000:1000 "$APP_DIR/data"

if [ ! -f "$ENV_FILE" ]; then
  umask 077
  postgres_password="$(openssl rand -hex 24)"
  master_key="$(openssl rand -hex 32)"
  metrics_token="$(openssl rand -hex 32)"
  {
    printf 'POSTGRES_PASSWORD=%s\n' "$postgres_password"
    printf 'CLIENT_SECRET_MASTER_KEY=%s\n' "$master_key"
    printf 'METRICS_TOKEN=%s\n' "$metrics_token"
  } > "$ENV_FILE"
fi

cd "$APP_DIR/deploy"
docker-compose --env-file .env.production config >/dev/null
docker-compose --env-file .env.production up -d --build
