import path from 'node:path';
import { SAPICS_DATASETS } from './data/sapicsCatalog.js';

const VALID_NODE_ENVS = new Set(['development', 'test', 'production']);
const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const VALID_DATABASE_SSL_MODES = new Set(['disable', 'require', 'verify-full']);

function readInteger(env, name, fallback, { min, max }) {
  const raw = env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }

  return value;
}

function readBoolean(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  throw new Error(`${name} must be one of: 1, 0, true, false`);
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const nodeEnv = env.NODE_ENV || 'development';
  const logLevel = env.LOG_LEVEL || 'info';
  const host = env.HOST || '127.0.0.1';

  if (!VALID_NODE_ENVS.has(nodeEnv)) {
    throw new Error(`NODE_ENV must be one of: ${[...VALID_NODE_ENVS].join(', ')}`);
  }

  if (!VALID_LOG_LEVELS.has(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of: ${[...VALID_LOG_LEVELS].join(', ')}`);
  }

  if (typeof host !== 'string' || host.trim() === '' || /\s/.test(host)) {
    throw new Error('HOST must be a non-empty hostname or IP address without whitespace');
  }

  const databaseUrl = env.DATABASE_URL || '';
  const databaseSslMode = env.DATABASE_SSL_MODE || 'disable';
  const clientSecretMasterKey = env.CLIENT_SECRET_MASTER_KEY || '';
  const metricsToken = env.METRICS_TOKEN || '';
  const dataDir = path.resolve(cwd, env.IP_DATA_DIR || './data');
  const configDir = path.resolve(cwd, env.IP_CONFIG_DIR || './config');

  if (!VALID_DATABASE_SSL_MODES.has(databaseSslMode)) {
    throw new Error(`DATABASE_SSL_MODE must be one of: ${[...VALID_DATABASE_SSL_MODES].join(', ')}`);
  }

  if (clientSecretMasterKey && !/^[0-9a-fA-F]{64}$/.test(clientSecretMasterKey)) {
    throw new Error('CLIENT_SECRET_MASTER_KEY must contain exactly 64 hexadecimal characters');
  }

  if (databaseUrl && !clientSecretMasterKey) {
    throw new Error('CLIENT_SECRET_MASTER_KEY is required when DATABASE_URL is configured');
  }

  if (nodeEnv === 'production' && !databaseUrl) {
    throw new Error('DATABASE_URL is required when NODE_ENV is production');
  }

  const metricsEnabled = readBoolean(env, 'METRICS_ENABLED', false);
  if (metricsEnabled && metricsToken.length < 32) {
    throw new Error('METRICS_TOKEN must contain at least 32 characters when metrics are enabled');
  }

  const ip2ProxyAutoUpdateEnabled = readBoolean(env, 'IP2PROXY_AUTO_UPDATE_ENABLED', false);
  const ip2ProxyDownloadToken = String(env.IP2PROXY_DOWNLOAD_TOKEN || '').trim();
  const ip2ProxyDownloadCode = String(env.IP2PROXY_DOWNLOAD_CODE || '').trim();
  if (ip2ProxyAutoUpdateEnabled && (!ip2ProxyDownloadToken || !/^[A-Za-z0-9_-]+$/.test(ip2ProxyDownloadCode))) {
    throw new Error('IP2Proxy automatic updates require a download token and a safe download code');
  }

  return Object.freeze({
    serviceName: 'ip-intelligence-service',
    nodeEnv,
    logLevel,
    host,
    port: readInteger(env, 'PORT', 3101, { min: 1, max: 65535 }),
    shutdownTimeoutMs: readInteger(env, 'SHUTDOWN_TIMEOUT_MS', 10_000, {
      min: 1_000,
      max: 60_000,
    }),
    dataDir,
    configDir,
    ipData: Object.freeze({
      cityPath: path.resolve(dataDir, env.DBIP_CITY_MMDB_FILE || 'dbip-city-lite.mmdb'),
      asnPath: path.resolve(dataDir, env.DBIP_ASN_MMDB_FILE || 'dbip-asn-lite.mmdb'),
      maxmindCountryPath: path.resolve(dataDir, 'maxmind-geolite2-country.mmdb'),
      maxmindCityPath: path.resolve(dataDir, 'maxmind-geolite2-city.mmdb'),
      maxmindAsnPath: path.resolve(dataDir, 'maxmind-geolite2-asn.mmdb'),
      ipgeoCommunityPath: path.resolve(dataDir, 'ipgeo-community.mmdb'),
      cloudRangesPath: path.resolve(dataDir, env.CLOUD_RANGES_FILE || 'cloud-ranges.json'),
      cloudRangePaths: Object.freeze([
        path.resolve(dataDir, env.CLOUD_RANGES_FILE || 'cloud-ranges.json'),
        path.resolve(dataDir, 'cloud-ranges-extended.json'),
        path.resolve(dataDir, 'azure-public-service-tags.json'),
        path.resolve(dataDir, 'azure-china-service-tags.json'),
        path.resolve(dataDir, 'akamai-ranges.json'),
        path.resolve(dataDir, 'github-meta-ranges.json'),
      ]),
      torExitPath: path.resolve(dataDir, env.TOR_EXIT_LIST_FILE || 'tor-exit-nodes.txt'),
      ip2ProxyPath: path.resolve(dataDir, env.IP2PROXY_BIN_FILE || 'IP2PROXY-LITE.BIN'),
      sapicsDatasets: SAPICS_DATASETS.map((dataset) => ({
        ...dataset,
        filePath: path.resolve(dataDir, env[`SAPICS_${dataset.id.replace('sapics-', '').replaceAll('-', '_').toUpperCase()}_MMDB_FILE`] || dataset.fileName),
      })),
      classificationRulesPath: path.resolve(
        configDir,
        env.ASN_CLASSIFICATION_FILE || 'asn-classification.json',
      ),
      cacheSize: readInteger(env, 'MMDB_CACHE_SIZE', 10_000, {
        min: 0,
        max: 100_000,
      }),
      autoUpdateEnabled: readBoolean(env, 'IP_DATA_AUTO_UPDATE_ENABLED', false),
      updateIntervalMs: readInteger(env, 'IP_DATA_UPDATE_INTERVAL_HOURS', 6, {
        min: 1,
        max: 168,
      }) * 60 * 60 * 1_000,
      updateStartupDelayMs: readInteger(env, 'IP_DATA_UPDATE_STARTUP_DELAY_SECONDS', 60, {
        min: 5,
        max: 3_600,
      }) * 1_000,
      ip2ProxyAutoUpdateEnabled,
      sapicsAutoUpdateEnabled: readBoolean(env, 'SAPICS_AUTO_UPDATE_ENABLED', false),
      sapicsUpdateHourBjt: readInteger(env, 'SAPICS_UPDATE_HOUR_BJT', 8, { min: 0, max: 23 }),
      ip2ProxyDownloadToken,
      ip2ProxyDownloadCode,
      ip2ProxyUpdateIntervalMs: readInteger(env, 'IP2PROXY_UPDATE_INTERVAL_DAYS', 7, {
        min: 1,
        max: 31,
      }) * 24 * 60 * 60 * 1_000,
    }),
    database: Object.freeze({
      enabled: Boolean(databaseUrl),
      url: databaseUrl,
      sslMode: databaseSslMode,
      poolMax: readInteger(env, 'DATABASE_POOL_MAX', 10, { min: 1, max: 50 }),
      idleTimeoutMs: readInteger(env, 'DATABASE_IDLE_TIMEOUT_MS', 30_000, {
        min: 1_000,
        max: 300_000,
      }),
      connectionTimeoutMs: readInteger(env, 'DATABASE_CONNECTION_TIMEOUT_MS', 5_000, {
        min: 500,
        max: 60_000,
      }),
    }),
    clientSecretMasterKey,
    security: Object.freeze({
      hmacClockSkewSeconds: readInteger(env, 'HMAC_MAX_CLOCK_SKEW_SECONDS', 60, {
        min: 5,
        max: 300,
      }),
      nonceTtlSeconds: readInteger(env, 'NONCE_TTL_SECONDS', 300, {
        min: 60,
        max: 3_600,
      }),
      nonceMaxEntries: readInteger(env, 'NONCE_MAX_ENTRIES', 100_000, {
        min: 1_000,
        max: 1_000_000,
      }),
      maxBodyBytes: readInteger(env, 'MAX_REQUEST_BODY_BYTES', 32_768, {
        min: 1_024,
        max: 1_048_576,
      }),
    }),
    http: Object.freeze({
      requestTimeoutMs: readInteger(env, 'HTTP_REQUEST_TIMEOUT_MS', 10_000, {
        min: 1_000,
        max: 120_000,
      }),
      headersTimeoutMs: readInteger(env, 'HTTP_HEADERS_TIMEOUT_MS', 10_000, {
        min: 1_000,
        max: 120_000,
      }),
      keepAliveTimeoutMs: readInteger(env, 'HTTP_KEEP_ALIVE_TIMEOUT_MS', 5_000, {
        min: 1_000,
        max: 60_000,
      }),
    }),
    observability: Object.freeze({
      metricsEnabled,
      metricsToken,
      slowRequestMs: readInteger(env, 'SLOW_REQUEST_THRESHOLD_MS', 1_000, {
        min: 10,
        max: 120_000,
      }),
    }),
    publicLookup: Object.freeze({
      enabled: readBoolean(env, 'PUBLIC_LOOKUP_ENABLED', true),
      trustProxy: readBoolean(env, 'PUBLIC_TRUST_PROXY', false),
      rateLimitPerMinute: readInteger(env, 'PUBLIC_LOOKUP_RATE_LIMIT_PER_MINUTE', 30, {
        min: 1,
        max: 1_000,
      }),
    }),
  });
}
