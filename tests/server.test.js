import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadiness } from '../src/readiness.js';
import { createHttpServer } from '../src/server.js';
import { MetricsRegistry } from '../src/observability/MetricsRegistry.js';
import { ClientRateLimiter } from '../src/security/ClientRateLimiter.js';

const silentLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
});

const allowAuthenticator = {
  async authenticate() {
    return {
      client: { id: 1 },
      rate_limit_limit: 100,
      rate_limit_remaining: 99,
      rate_limit_reset: 42,
    };
  },
};

async function withServer(
  readiness,
  run,
  authenticator = allowAuthenticator,
  lookupService = null,
  usageRepository = null,
  overrides = {},
) {
  const { config: configOverrides = {}, ...serverOverrides } = overrides;
  const defaultConfig = {
    serviceName: 'ip-intelligence-service',
    security: { maxBodyBytes: 32_768 },
    http: {
      requestTimeoutMs: 10_000,
      headersTimeoutMs: 10_000,
      keepAliveTimeoutMs: 5_000,
    },
    observability: { metricsEnabled: false, metricsToken: '', slowRequestMs: 1_000 },
  };
  const server = createHttpServer({
    config: { ...defaultConfig, ...configOverrides },
    logger: silentLogger,
    readiness,
    authenticator,
    lookupService,
    usageRepository,
    ...serverOverrides,
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('metrics endpoint is disabled by default and requires its own bearer token', async () => {
  const readiness = createReadiness([{ id: 'dbip-city', required: true, ready: true }]);
  const metrics = new MetricsRegistry();
  await withServer(readiness, async (baseUrl) => {
    const disabled = await fetch(`${baseUrl}/metrics`);
    assert.equal(disabled.status, 404);
  }, allowAuthenticator, null, null, { metrics });

  await withServer(readiness, async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/metrics`);
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get('www-authenticate'), 'Bearer');

    const response = await fetch(`${baseUrl}/metrics`, {
      headers: { authorization: `Bearer ${'m'.repeat(32)}` },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/plain/);
    assert.match(await response.text(), /ip_intelligence_info/);
  }, {
    async authenticate() { throw new Error('metrics must not use HMAC authentication'); },
  }, null, null, {
    metrics,
    config: {
      observability: {
        metricsEnabled: true,
        metricsToken: 'm'.repeat(32),
        slowRequestMs: 1_000,
      },
    },
  });
});

test('observability endpoint uses HMAC authentication and returns aggregate runtime state', async () => {
  const readiness = createReadiness([{ id: 'dbip-city', required: true, ready: true }]);
  const metrics = new MetricsRegistry();
  await withServer(readiness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/meta/observability`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.code, 'OK');
    assert.equal(body.data.readiness.required_sources_ready, true);
    assert.equal(typeof body.data.process.heap_used_bytes, 'number');
  }, allowAuthenticator, null, null, { metrics });
});

test('admin shell uses account sessions while metrics keeps its separate bearer token', async () => {
  const metrics = new MetricsRegistry();
  const readiness = createReadiness([{ id: 'dbip-city', required: true, ready: true }]);
  const adminAssets = {
    index: { body: Buffer.from('<!doctype html><title>Admin</title>'), contentType: 'text/html; charset=utf-8' },
    style: { body: Buffer.from('body{}'), contentType: 'text/css; charset=utf-8' },
    script: { body: Buffer.from(''), contentType: 'text/javascript; charset=utf-8' },
  };
  let active = true;
  const adminAuthService = {
    async login(username, password) {
      if (username !== 'admin' || password !== 'correct-password') {
        const error = new Error('账号或密码错误');
        error.statusCode = 401;
        throw error;
      }
      return {
        sessionToken: 's'.repeat(64), csrfToken: 'csrf-value', expiresAt: new Date(Date.now() + 60_000),
        user: { id: 1, username: 'admin' },
      };
    },
    async authenticate(token) {
      return active && token === 's'.repeat(64)
        ? { tokenHash: 'hash', csrf_token_hash: 'csrf-hash', admin_user_id: 1, username: 'admin' }
        : null;
    },
    async refreshCsrf() { return 'csrf-value'; },
    verifyCsrf(_session, token) { return token === 'csrf-value'; },
    async logout() { active = false; },
    async changeCredentials() { active = false; },
  };
  await withServer(readiness, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/admin`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);

    const denied = await fetch(`${baseUrl}/admin/api/observability`);
    assert.equal(denied.status, 401);

    const login = await fetch(`${baseUrl}/admin/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'correct-password' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';', 1)[0];
    assert.match(login.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
    const allowed = await fetch(`${baseUrl}/admin/api/observability`, {
      headers: { cookie },
    });
    const body = await allowed.json();
    assert.equal(allowed.status, 200);
    assert.equal(body.code, 'OK');
    assert.equal(body.data.readiness.required_sources_ready, true);

    const session = await fetch(`${baseUrl}/admin/api/session`, { headers: { cookie } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).data.user.username, 'admin');

    const logout = await fetch(`${baseUrl}/admin/api/logout`, {
      method: 'POST', headers: { cookie, 'x-csrf-token': 'csrf-value' },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  }, allowAuthenticator, null, null, {
    metrics,
    adminAssets,
    adminAuthService,
    adminRateLimiter: new ClientRateLimiter(),
    config: {
      observability: { metricsEnabled: true, metricsToken: 'a'.repeat(32), slowRequestMs: 1_000 },
    },
  });
});

test('public lookup shell and single-IP endpoint work without exposing HMAC credentials', async () => {
  const readiness = createReadiness([
    { id: 'dbip-city', required: true, ready: true },
    { id: 'dbip-asn', required: true, ready: true },
  ]);
  const publicAssets = {
    index: { body: Buffer.from('<!doctype html><title>IP lookup</title>'), contentType: 'text/html; charset=utf-8' },
    style: { body: Buffer.from('body{}'), contentType: 'text/css; charset=utf-8' },
    script: { body: Buffer.from(''), contentType: 'text/javascript; charset=utf-8' },
  };
  const lookupService = {
    lookupBatch(ips) {
      return {
        data: [{ ip: ips[0], status: 'resolved', sources: ['dbip-city'] }],
        meta: { generated_at: '2026-09-11T00:00:00.000Z', database_versions: {} },
      };
    },
  };

  await withServer(readiness, async (baseUrl) => {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);

    const response = await fetch(`${baseUrl}/api/public/lookup?ip=1.1.1.1`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.code, 'OK');
    assert.equal(body.data.ip, '1.1.1.1');
    assert.equal(response.headers.get('x-rate-limit-limit'), '2');
    assert.equal(response.headers.get('x-rate-limit-remaining'), '1');
  }, {
    async authenticate() { throw new Error('public lookup must not use HMAC authentication'); },
  }, lookupService, null, {
    publicAssets,
    publicRateLimiter: new ClientRateLimiter(),
    config: { publicLookup: { enabled: true, trustProxy: false, rateLimitPerMinute: 2 } },
  });
});

test('public lookup rate limit is independent and returns Retry-After', async () => {
  const readiness = createReadiness([
    { id: 'dbip-city', required: true, ready: true },
    { id: 'dbip-asn', required: true, ready: true },
  ]);
  const lookupService = {
    lookupBatch(ips) {
      return { data: [{ ip: ips[0], status: 'resolved' }], meta: {} };
    },
  };

  await withServer(readiness, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/api/public/lookup?ip=8.8.8.8`)).status, 200);
    const limited = await fetch(`${baseUrl}/api/public/lookup?ip=1.1.1.1`);
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, 'RATE_LIMITED');
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  }, allowAuthenticator, lookupService, null, {
    publicRateLimiter: new ClientRateLimiter(),
    config: { publicLookup: { enabled: true, trustProxy: false, rateLimitPerMinute: 1 } },
  });
});

test('health responds without requiring data providers', async () => {
  await withServer(createReadiness(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`, {
      headers: { 'x-request-id': 'req_health_test' },
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'req_health_test');
    assert.equal(body.request_id, 'req_health_test');
    assert.equal(body.ok, true);
    assert.equal(body.service, 'ip-intelligence-service');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('ready returns 503 until at least one required provider is ready', async () => {
  await withServer(createReadiness(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.code, 'SERVICE_NOT_READY');
    assert.equal(body.details.required_sources_ready, false);
  });
});

test('ready returns 200 when every required provider is ready', async () => {
  const readiness = createReadiness([
    { id: 'dbip-city', required: true, ready: true },
    { id: 'optional-proxy', required: false, ready: false },
  ]);

  await withServer(readiness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.required_sources_ready, true);
    assert.equal(body.sources.length, 2);
  });
});

test('unknown routes use the unified error envelope', async () => {
  await withServer(createReadiness(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/missing`);
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(body.details, null);
    assert.match(body.request_id, /^req_/);
  });
});

test('known routes reject unsupported methods with Allow', async () => {
  await withServer(createReadiness(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/ip/lookup`);
    const body = await response.json();

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.equal(body.code, 'METHOD_NOT_ALLOWED');
  });
});

test('private routes fail closed when authentication is not configured', async () => {
  await withServer(createReadiness(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/ready`);
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.code, 'SERVICE_NOT_READY');
  }, null);
});

test('lookup reads the exact request body before reporting providers unavailable', async () => {
  let capturedBody;
  const authenticator = {
    async authenticate(request) {
      capturedBody = request.rawBody;
      return { client: { id: 1 }, rate_limit_remaining: 8 };
    },
  };
  const bodyText = '{"ips":["1.1.1.1"]}';

  await withServer(createReadiness(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/ip/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyText,
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(response.headers.get('x-rate-limit-remaining'), '8');
    assert.equal(body.code, 'SERVICE_NOT_READY');
    assert.equal(capturedBody.toString('utf8'), bodyText);
  }, authenticator);
});

test('lookup requires the declared JSON media type before authentication', async () => {
  let authenticateCalls = 0;
  const authenticator = {
    async authenticate() {
      authenticateCalls += 1;
      return { client: { id: 1 }, rate_limit_remaining: 8 };
    },
  };
  await withServer(createReadiness(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/ip/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).code, 'UNSUPPORTED_MEDIA_TYPE');
    assert.equal(authenticateCalls, 0);
  }, authenticator);
});

test('lookup rejects declared request bodies above the configured limit before authentication', async () => {
  let authenticateCalls = 0;
  const authenticator = {
    async authenticate() {
      authenticateCalls += 1;
      return { client: { id: 1 }, rate_limit_remaining: 8 };
    },
  };

  await withServer(createReadiness(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/ip/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(32_769),
    });
    const body = await response.json();

    assert.equal(response.status, 413);
    assert.equal(body.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(authenticateCalls, 0);
  }, authenticator);
});

test('lookup validates JSON structure and batch size after authentication', async () => {
  const lookupService = { lookupBatch() { throw new Error('must not run'); } };
  await withServer(createReadiness(), async (baseUrl) => {
    const invalidJson = await fetch(`${baseUrl}/v1/ip/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(invalidJson.status, 400);
    assert.equal((await invalidJson.json()).code, 'INVALID_JSON');

    const empty = await fetch(`${baseUrl}/v1/ip/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ips: [] }),
    });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).code, 'INVALID_REQUEST');

    const tooMany = await fetch(`${baseUrl}/v1/ip/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ips: Array.from({ length: 101 }, () => '1.1.1.1') }),
    });
    assert.equal(tooMany.status, 422);
    assert.equal((await tooMany.json()).code, 'BATCH_LIMIT_EXCEEDED');

    const invalidItemType = await fetch(`${baseUrl}/v1/ip/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ips: ['1.1.1.1', null] }),
    });
    assert.equal(invalidItemType.status, 400);
    assert.equal((await invalidItemType.json()).code, 'INVALID_REQUEST');
  }, allowAuthenticator, lookupService);
});

test('lookup returns the service batch result in the versioned envelope', async () => {
  const lookupService = {
    lookupBatch(ips) {
      return {
        data: [{ input: ips[0], status: 'resolved' }],
        meta: {
          requested_count: 1,
          unique_count: 1,
          resolved_count: 1,
          invalid_count: 0,
          unavailable_count: 0,
          generated_at: '2026-09-11T00:00:00.000Z',
          database_versions: {},
        },
      };
    },
  };
  const readiness = createReadiness([{ id: 'dbip-city', required: true, ready: true }]);
  await withServer(readiness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/ip/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ips: ['1.1.1.1'] }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.code, 'OK');
    assert.equal(body.data[0].input, '1.1.1.1');
    assert.equal(body.meta.resolved_count, 1);
    assert.equal(response.headers.get('x-rate-limit-limit'), '100');
    assert.equal(response.headers.get('x-rate-limit-remaining'), '99');
    assert.equal(response.headers.get('x-rate-limit-reset'), '42');
  }, allowAuthenticator, lookupService);
});

test('lookup fails closed when required IP databases are not ready', async () => {
  let lookupCalls = 0;
  const lookupService = { lookupBatch() { lookupCalls += 1; } };
  const readiness = createReadiness([{ id: 'dbip-city', required: true, ready: false }]);

  await withServer(readiness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/ip/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ips: ['1.1.1.1'] }),
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'SERVICE_NOT_READY');
    assert.equal(lookupCalls, 0);
  }, allowAuthenticator, lookupService);
});

test('lookup records only aggregate usage counts after responding', async () => {
  let recorded = null;
  const readiness = createReadiness([{ id: 'dbip-city', required: true, ready: true }]);
  const lookupService = {
    lookupBatch() {
      return {
        data: [{ input: '1.1.1.1', status: 'resolved' }],
        meta: {
          requested_count: 2,
          unique_count: 1,
          resolved_count: 1,
          invalid_count: 0,
          unavailable_count: 0,
          generated_at: '2026-09-11T00:00:00.000Z',
          database_versions: {},
        },
      };
    },
  };
  const usageRepository = {
    async recordUsage(value) { recorded = value; },
  };

  await withServer(readiness, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/ip/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ips: ['1.1.1.1', '1.1.1.1'] }),
    });
    assert.equal(response.status, 200);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(recorded.apiClientId, 1);
    assert.equal(recorded.requests, 1);
    assert.equal(recorded.ips, 1);
    assert.equal('ip' in recorded, false);
  }, allowAuthenticator, lookupService, usageRepository);
});
