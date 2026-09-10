import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('loadConfig applies safe local defaults', () => {
  const cwd = path.resolve('fixture-project');
  const config = loadConfig({}, cwd);

  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3101);
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.logLevel, 'info');
  assert.equal(config.shutdownTimeoutMs, 10_000);
  assert.equal(config.security.hmacClockSkewSeconds, 60);
  assert.equal(config.security.nonceTtlSeconds, 300);
  assert.equal(config.security.maxBodyBytes, 32_768);
  assert.equal(config.http.requestTimeoutMs, 10_000);
  assert.equal(config.ipData.cityPath, path.resolve(cwd, 'data/dbip-city-lite.mmdb'));
  assert.equal(config.ipData.asnPath, path.resolve(cwd, 'data/dbip-asn-lite.mmdb'));
  assert.equal(config.ipData.cloudRangesPath, path.resolve(cwd, 'data/cloud-ranges.json'));
  assert.equal(config.ipData.torExitPath, path.resolve(cwd, 'data/tor-exit-nodes.txt'));
  assert.equal(config.ipData.ip2ProxyPath, path.resolve(cwd, 'data/IP2PROXY-LITE.BIN'));
  assert.equal(config.ipData.classificationRulesPath, path.resolve(cwd, 'config/asn-classification.json'));
  assert.equal(config.ipData.cacheSize, 10_000);
  assert.equal(config.ipData.autoUpdateEnabled, false);
  assert.equal(config.ipData.updateIntervalMs, 6 * 60 * 60 * 1_000);
  assert.equal(config.ipData.updateStartupDelayMs, 60_000);
  assert.equal(config.http.headersTimeoutMs, 10_000);
  assert.equal(config.http.keepAliveTimeoutMs, 5_000);
  assert.equal(config.observability.metricsEnabled, false);
  assert.equal(config.observability.metricsToken, '');
  assert.equal(config.observability.slowRequestMs, 1_000);
  assert.equal(config.publicLookup.enabled, true);
  assert.equal(config.publicLookup.trustProxy, false);
  assert.equal(config.publicLookup.rateLimitPerMinute, 30);
  assert.equal(config.dataDir, path.resolve(cwd, 'data'));
  assert.equal(config.configDir, path.resolve(cwd, 'config'));
  assert.equal(Object.isFrozen(config), true);
});

test('loadConfig validates numeric and enumerated settings', () => {
  assert.throws(() => loadConfig({ PORT: '0' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT must be an integer/);
  assert.throws(() => loadConfig({ NODE_ENV: 'staging' }), /NODE_ENV must be one of/);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'verbose' }), /LOG_LEVEL must be one of/);
  assert.throws(() => loadConfig({ HOST: 'bad host' }), /HOST must be/);
  assert.throws(() => loadConfig({ IP_DATA_AUTO_UPDATE_ENABLED: 'yes' }), /must be one of/);
  assert.throws(() => loadConfig({ METRICS_ENABLED: 'true' }), /METRICS_TOKEN must contain/);
  assert.throws(() => loadConfig({ PUBLIC_LOOKUP_RATE_LIMIT_PER_MINUTE: '0' }), /must be an integer/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DATABASE_URL is required/);
  assert.throws(
    () => loadConfig({ DATABASE_URL: 'postgresql://localhost/test' }),
    /CLIENT_SECRET_MASTER_KEY is required/,
  );
  assert.throws(
    () => loadConfig({ CLIENT_SECRET_MASTER_KEY: 'short' }),
    /64 hexadecimal characters/,
  );
});

test('loadConfig accepts explicit public lookup settings', () => {
  const config = loadConfig({
    PUBLIC_LOOKUP_ENABLED: '0',
    PUBLIC_TRUST_PROXY: '1',
    PUBLIC_LOOKUP_RATE_LIMIT_PER_MINUTE: '45',
  });
  assert.equal(config.publicLookup.enabled, false);
  assert.equal(config.publicLookup.trustProxy, true);
  assert.equal(config.publicLookup.rateLimitPerMinute, 45);
});

test('loadConfig accepts protected metrics settings', () => {
  const token = 'm'.repeat(32);
  const config = loadConfig({
    METRICS_ENABLED: '1',
    METRICS_TOKEN: token,
    SLOW_REQUEST_THRESHOLD_MS: '750',
  });
  assert.equal(config.observability.metricsEnabled, true);
  assert.equal(config.observability.metricsToken, token);
  assert.equal(config.observability.slowRequestMs, 750);
});

test('loadConfig accepts explicit automatic update settings', () => {
  const config = loadConfig({
    IP_DATA_AUTO_UPDATE_ENABLED: 'true',
    IP_DATA_UPDATE_INTERVAL_HOURS: '12',
    IP_DATA_UPDATE_STARTUP_DELAY_SECONDS: '30',
  });
  assert.equal(config.ipData.autoUpdateEnabled, true);
  assert.equal(config.ipData.updateIntervalMs, 12 * 60 * 60 * 1_000);
  assert.equal(config.ipData.updateStartupDelayMs, 30_000);
});

test('loadConfig exposes PostgreSQL pool settings without leaking them elsewhere', () => {
  const key = 'a'.repeat(64);
  const config = loadConfig({
    DATABASE_URL: 'postgresql://localhost/ip_intelligence',
    CLIENT_SECRET_MASTER_KEY: key,
    DATABASE_SSL_MODE: 'verify-full',
    DATABASE_POOL_MAX: '12',
  });

  assert.equal(config.database.enabled, true);
  assert.equal(config.database.sslMode, 'verify-full');
  assert.equal(config.database.poolMax, 12);
  assert.equal(config.clientSecretMasterKey, key);
});
