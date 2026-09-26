# IP Intelligence Service

[中文文档](README.md)

IP Intelligence Service combines geography, ASN, proxy/VPN/Tor, cloud/CDN, RPKI, routing, registry, reputation, and manual-classification evidence into one result. Navigation servers use its HMAC-authenticated API; operators manage sources, clients, updates, and rules through a separate admin console.

> Download tokens, license keys, client secrets, administrator passwords, and database keys remain server-side. Sensitive admin fields never return plaintext.

## 1. Features

- HMAC-SHA256 `POST /v1/ip/lookup`, clock-skew checks, nonce replay protection, and client rate limits.
- Optional rate-limited public single-IP lookup.
- PostgreSQL clients, usage, audit, feedback, update jobs, and admin sessions.
- One-time client-secret display, rotation, disablement, and master-key encryption.
- DB-IP/MaxMind/SAPICS MMDB, IP2Proxy LITE BIN, and in-memory caches.
- Cloud/CDN, Tor, RPKI, BGP, RIR/RDAP, special-address, fullbogon, crawler, Private Relay, and reputation evidence.
- Evidence priority/conflict adjudication, Chinese localization, and manual classification rules.
- Source checking, download, force update, scheduled update, status, and failure reasons.
- `/health`, `/ready`, and optional bearer-protected Prometheus `/metrics`.

## 2. Placement

Run it with Control Center on server B:

- Control Center `127.0.0.1:3100`
- IP Intelligence `127.0.0.1:3101`
- PostgreSQL `127.0.0.1:5432`, separate users/databases
- Optional Routinator `127.0.0.1:8323`
- One Caddy for `control.example.com` and `ip.example.com`

The bundled Docker/Caddy stack suits a dedicated IP host. On a shared host, do not start that Caddy container unchanged because it conflicts on 80/443. This guide uses native Node systemd plus host PostgreSQL.

## 3. Clean-host installation

### 3.1 Packages and user

```bash
sudo apt update
sudo apt install -y ca-certificates curl git build-essential postgresql unzip
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo useradd --system --create-home --home-dir /opt/apps --shell /usr/sbin/nologin apps
sudo mkdir -p /opt/ip-intelligence /etc/ip-intelligence /var/lib/ip-intelligence/data /var/lib/ip-intelligence/config
sudo chown -R apps:apps /opt/ip-intelligence /var/lib/ip-intelligence
sudo chmod 750 /etc/ip-intelligence
```

### 3.2 Empty database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER ip_service WITH ENCRYPTED PASSWORD 'REPLACE_WITH_RANDOM_DATABASE_PASSWORD';
CREATE DATABASE ip_intelligence OWNER ip_service;
REVOKE ALL ON DATABASE ip_intelligence FROM PUBLIC;
SQL
```

Generate the password. This user owns only `ip_intelligence`.

### 3.3 Clone and install

```bash
sudo -u apps git clone https://github.com/zhangsan4188/ip-intelligence-service.git /opt/ip-intelligence
cd /opt/ip-intelligence
sudo -u apps npm ci --omit=dev
```

Mirror: `https://github.com/chinazhangsan999-crypto/IP-Intelligence-Service.git`. A server Deploy Key needs only `Contents: Read`.

### 3.4 Environment

```bash
openssl rand -hex 32      # CLIENT_SECRET_MASTER_KEY
openssl rand -base64 48  # optional METRICS_TOKEN
```

Create `/opt/ip-intelligence/.env`:

```dotenv
NODE_ENV=production
PORT=3101
HOST=127.0.0.1
LOG_LEVEL=info
IP_DATA_DIR=/var/lib/ip-intelligence/data
IP_CONFIG_DIR=/var/lib/ip-intelligence/config
DATABASE_URL=postgresql://ip_service:<database-password>@127.0.0.1:5432/ip_intelligence
DATABASE_SSL_MODE=disable
DATABASE_POOL_MAX=10
CLIENT_SECRET_MASTER_KEY=<64-hex-character-random-value>
REDIS_URL=
HMAC_MAX_CLOCK_SKEW_SECONDS=60
NONCE_TTL_SECONDS=300
NONCE_MAX_ENTRIES=100000
PUBLIC_LOOKUP_ENABLED=1
PUBLIC_LOOKUP_RATE_LIMIT_PER_MINUTE=30
PUBLIC_TRUST_PROXY=1
METRICS_ENABLED=0
METRICS_TOKEN=<separate-random-value-when-enabled>
IP_DATA_AUTO_UPDATE_ENABLED=1
IP_DATA_UPDATE_INTERVAL_HOURS=6
IP_DATA_UPDATE_STARTUP_DELAY_SECONDS=60
IP2PROXY_AUTO_UPDATE_ENABLED=0
IP2PROXY_DOWNLOAD_TOKEN=
IP2PROXY_DOWNLOAD_CODE=PX12LITEBIN
SAPICS_AUTO_UPDATE_ENABLED=0
CAIDA_AUA_ACCEPTED=0
PEERINGDB_AUP_ACCEPTED=0
ROUTINATOR_URL=
```

```bash
sudo chown apps:apps /opt/ip-intelligence/.env
sudo chmod 600 /opt/ip-intelligence/.env
```

The master key encrypts client secrets and must be permanently retained. Replacing it makes existing ciphertext undecryptable. Set `PUBLIC_TRUST_PROXY=1` only behind a trusted Caddy that overwrites forwarding headers.

### 3.5 Migrate and create the administrator

```bash
cd /opt/ip-intelligence
sudo -u apps npm run db:migrate
sudo -u apps npm run admin:account -- admin
```

On an empty database this creates `admin/admin123` and prints JSON once. It refuses to overwrite an existing admin. Change the password immediately; current validation allows 8–128 characters.

### 3.6 systemd and Caddy

```ini
[Unit]
Description=IP Intelligence Service
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=apps
Group=apps
WorkingDirectory=/opt/ip-intelligence
ExecStartPre=/usr/bin/npm run db:migrate
ExecStart=/usr/bin/node --env-file=.env src/app.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/opt/ip-intelligence /var/lib/ip-intelligence

[Install]
WantedBy=multi-user.target
```

```caddyfile
control.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3100
}

ip.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3101
}
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ip-intelligence
curl -fsS http://127.0.0.1:3101/ready
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
curl -fsS https://ip.example.com/health
```

## 4. Create a navigation API client

```bash
cd /opt/ip-intelligence
sudo -u apps npm run client:admin -- create nav-main "Main Navigation" 600
```

Save the one-time client secret in Navigation. Other commands:

```bash
sudo -u apps npm run client:admin -- list
sudo -u apps npm run client:admin -- rotate nav-main
sudo -u apps npm run client:admin -- disable nav-main
```

Use one client per site and realistic per-minute limits. Rotation invalidates the old secret. Keep both servers time-synchronized for HMAC timestamps.

## 5. Data-source inventory

### 5.1 No account/token required

| Source | Evidence | Terms/cautions |
|---|---|---|
| DB-IP City/ASN Lite | geography and ASN | CC BY 4.0 attribution |
| AWS, Google Cloud, Cloudflare ranges | cloud/CDN | upstream terms |
| Tor Project/Onionoo | exits | upstream terms |
| SAPICS MMDB collection | country/city/ASN | per-file PDDL, GeoLite2, or CC BY |
| RIPE RIS and RouteViews | BGP/routing | upstream terms and large downloads |
| NRO/RIR delegated stats | allocation | RIR terms and checksums |
| IANA RDAP bootstrap | RDAP directory | IANA data terms |
| IANA Special-Purpose | special IPv4/IPv6 | IANA data terms |
| Team Cymru Fullbogons | unallocated/unrouted | community-service terms |
| Google/Bing crawler ranges | verified-bot ranges | range evidence still needs the chosen DNS verification policy |
| Apple Private Relay | relay egress | Apple terms |
| Oracle, Fastly, DigitalOcean | cloud/CDN | respective terms |
| Azure Public/China | service tags | Microsoft terms; source URLs can change |
| GitHub Meta | GitHub service ranges | anonymous works; token only mitigates rate limits |
| Spamhaus DROP | risky netblocks | preserve attribution/date; never block on this alone |
| ipgeo Community | geo/ASN/VPN | CC BY-SA 4.0 |
| IPsum | malicious-IP occurrence | repository terms; reputation evidence only |

“No token” does not mean unrestricted redistribution. Review every upstream license and expose conclusions rather than restricted raw datasets.

### 5.2 Account or token required

#### MaxMind GeoLite2

Enter Account ID and License Key. Create/verify an account, accept the GeoLite2 EULA, generate a database-download license key, and test Country/City/ASN downloads. MaxMind Web Service permission is not required. Treat the key as secret and do not redistribute GeoLite2 without complying with its EULA.

#### IP2Proxy LITE

Enter `IP2PROXY_DOWNLOAD_TOKEN` and product download code such as `PX12LITEBIN`. Create a LITE account, generate a **Download Token**, select an available LITE BIN product, test manually, then enable auto-update. This is not an IP2Proxy Web Service API key.

#### Optional GitHub Meta token

Anonymous `/meta` works. If rate-limited, use an expiring fine-grained PAT with read-only `Metadata: Read`; no Contents write, Issues, Actions, Secrets, or Administration.

### 5.3 Acceptance or a local component required

- Set `CAIDA_AUA_ACCEPTED=1` only after the responsible operator accepts the AUA and confirms the use is allowed.
- Set `PEERINGDB_AUP_ACCEPTED=1` only after accepting the AUP.
- Routinator requires no cloud account but stays local/private.
- SAPICS contains multiple licenses; auto-update does not grant extra redistribution rights.

### 5.4 Removed/not required

- Akamai is removed from the admin source list; no Akamai account/token is needed.
- Spamhaus DROP needs no account in the current source, but attribution and use limits still apply.

## 6. Optional Routinator

Run NLnet Labs Routinator internally, persist its RPKI cache, update trust anchors/ROAs, and expose HTTP/RTR only to loopback/private networking. Set `ROUTINATOR_URL=http://127.0.0.1:8323/json` only after a JSON health check. RPKI invalid is strong evidence but should not alone cause an irreversible visitor ban.

## 7. Data updates

```bash
cd /opt/ip-intelligence
sudo -u apps npm run data:update-dbip
sudo -u apps npm run data:update-open
sudo -u apps npm run data:update-ip2proxy
sudo -u apps npm run data:update-sapics
sudo -u apps npm run data:update-all
```

Admin checks/downloads are also available. Download to temporary files, validate, then atomically replace. Keep the last good data on failure; never hand-write a partial MMDB/BIN into the live directory.

## 8. API security model

A navigation request carries Client ID, timestamp, nonce, body hash, and HMAC. The service checks enabled/decryptable client state, time skew, nonce uniqueness, body limits, timing-safe signature equality, and rate limit. Client secrets never belong in browser JavaScript. Metrics bearer tokens, API secrets, and admin sessions are separate identities.

## 9. Backup, upgrade, rollback

Back up PostgreSQL, `.env`, `config/`, manual rules, and a manifest of current data files. Public files can be downloaded again; custom classification and credentials cannot.

```bash
sudo -u postgres pg_dump -Fc ip_intelligence > /secure-backups/ip-intelligence-$(date +%F-%H%M).dump
cd /opt/ip-intelligence
sudo -u apps git fetch --all --prune
sudo -u apps git pull --ff-only
sudo -u apps npm ci --omit=dev
sudo -u apps npm test
sudo systemctl restart ip-intelligence
curl -fsS http://127.0.0.1:3101/ready
```

Rollback compatible code, database, and configuration together. Validate source data offline before returning traffic.

## 10. Acceptance checklist

- `/health` and `/ready` pass; 3101/5432/8323 are not directly public.
- `admin/admin123` works once, then changes and invalidates the old session.
- Client create/read/rotate/disable works and plaintext secret appears once.
- Valid HMAC passes; wrong signature, stale timestamp, replayed nonce, and rate excess fail.
- DB-IP/open sources and configured MaxMind/IP2Proxy sources update and answer sample queries.
- Admin shows source, license, update time, version, and failure reason.
- Regression covers IPv4, IPv6, private/reserved, Tor, proxy, cloud, and residential samples.
- No license key, token, client secret, master key, or DB password appears in logs/API/Git.

## 11. Troubleshooting

- **Administrator exists:** `admin:account` refuses overwrite; change it in admin or follow recovery, never delete tables.
- **HMAC failure:** compare ID/secret, path, exact body bytes, clocks, and nonce. Rotation invalidates old secrets.
- **Download failure:** inspect license acceptance, token type, product code, disk, and egress.
- **MaxMind 401/403:** verify Account ID, License Key, EULA, and download entitlement; do not use legacy GeoIP keys.
- **IP2Proxy failure:** use Download Token plus LITE code, not Web Service key.
- **Source ready but field absent:** verify configured path, nonzero valid file, and target-IP coverage.
- **Spoofed public client IP:** enable trust proxy only behind trusted Caddy and block direct Node access.

## 12. Security and privacy

- `admin/admin123` is first-run only and must change immediately.
- One API client per navigation site; never use an admin client for visitor lookups.
- IP addresses are network identifiers: define purpose, retention, access, and audit instead of retaining raw behavior indefinitely.
- No single reputation source should impose a permanent ban; preserve evidence/confidence and a correction path.
- Apply least privilege, expiry, and rotation to every third-party credential.

## 13. Licensing and attribution

Every source retains its own license. Preserve source name, license, update date, and required attribution for GeoLite2, DB-IP, SAPICS assets, Spamhaus, PeeringDB, CAIDA, IPsum, and all other upstreams.

Official/upstream references: [MaxMind database updates](https://dev.maxmind.com/geoip/updating-databases/), [IP2Location/IP2Proxy LITE](https://www.ip2location.com/database/lite), [IANA RDAP data](https://data.iana.org/rdap/), and [Routinator documentation](https://routinator.docs.nlnetlabs.nl/en/stable/).
