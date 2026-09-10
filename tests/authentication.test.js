import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '../src/http/HttpError.js';
import { ClientRateLimiter } from '../src/security/ClientRateLimiter.js';
import { ReplayGuard } from '../src/security/ReplayGuard.js';
import { RequestAuthenticator } from '../src/security/RequestAuthenticator.js';
import { createRequestSignature } from '../src/security/hmac.js';

const nowMs = 1_789_000_000_000;
const timestamp = String(Math.floor(nowMs / 1_000));
const secret = 'client-shared-secret';
const rawBody = Buffer.from('{"ips":["1.1.1.1"]}', 'utf8');
const baseRequest = {
  method: 'POST',
  requestTarget: '/v1/ip/lookup',
  timestamp,
  nonce: 'nonce-000000000001',
  rawBody,
};

function createFixture({ status = 'active', limit = 10 } = {}) {
  const audits = [];
  let touches = 0;
  const record = {
    id: 7,
    client_id: 'nav-site-01',
    display_name: 'Navigation site 01',
    status,
    rate_limit_per_minute: limit,
  };
  const clientRepository = {
    async findAuthenticationRecord(clientId) {
      return clientId === record.client_id ? record : null;
    },
    async touchLastUsed() { touches += 1; },
  };
  const authenticator = new RequestAuthenticator({
    clientRepository,
    clientService: { decryptAuthenticationSecret: () => secret },
    replayGuard: new ReplayGuard({ ttlSeconds: 300, maxEntries: 1_000, now: () => nowMs }),
    rateLimiter: new ClientRateLimiter({ now: () => nowMs }),
    auditRepository: { async recordAudit(event) { audits.push(event); } },
    logger: { error() {} },
    clockSkewSeconds: 60,
    now: () => nowMs,
  });

  return { authenticator, audits, getTouches: () => touches };
}

function signedHeaders(overrides = {}) {
  const request = { ...baseRequest, ...overrides };
  return {
    'x-client-id': 'nav-site-01',
    'x-timestamp': request.timestamp,
    'x-nonce': request.nonce,
    'x-signature': createRequestSignature(secret, request),
  };
}

function authenticate(authenticator, headers, overrides = {}) {
  return authenticator.authenticate({
    headers,
    method: baseRequest.method,
    requestTarget: baseRequest.requestTarget,
    rawBody,
    requestId: 'req_auth_test',
    ...overrides,
  });
}

test('valid signatures authenticate and expose no secret', async () => {
  const fixture = createFixture();
  const result = await authenticate(fixture.authenticator, signedHeaders());
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result.client.client_id, 'nav-site-01');
  assert.equal(result.rate_limit_limit, 10);
  assert.equal(result.rate_limit_remaining, 9);
  assert.ok(result.rate_limit_reset > 0);
  assert.equal('secret' in result.client, false);
  assert.equal(fixture.getTouches(), 1);
});

test('missing, malformed, expired and tampered signatures are rejected', async () => {
  const cases = [
    [{}, 'AUTH_REQUIRED'],
    [{ ...signedHeaders(), 'x-signature': 'bad' }, 'INVALID_SIGNATURE'],
    [signedHeaders({ timestamp: String(Number(timestamp) - 61) }), 'INVALID_SIGNATURE'],
    [signedHeaders(), 'INVALID_SIGNATURE', { rawBody: Buffer.from('{}') }],
  ];

  for (const [headers, code, overrides] of cases) {
    const fixture = createFixture();
    await assert.rejects(
      authenticate(fixture.authenticator, headers, overrides),
      (error) => error instanceof HttpError && error.code === code,
    );
  }
});

test('a valid nonce cannot be replayed', async () => {
  const fixture = createFixture();
  const headers = signedHeaders();
  await authenticate(fixture.authenticator, headers);
  await assert.rejects(
    authenticate(fixture.authenticator, headers),
    (error) => error instanceof HttpError && error.code === 'REPLAY_DETECTED',
  );
});

test('disabled clients require a valid signature and then receive 403', async () => {
  const fixture = createFixture({ status: 'disabled' });
  await assert.rejects(
    authenticate(fixture.authenticator, signedHeaders()),
    (error) => error instanceof HttpError
      && error.statusCode === 403
      && error.code === 'CLIENT_DISABLED',
  );
});

test('per-client rate limits return Retry-After after the configured allowance', async () => {
  const fixture = createFixture({ limit: 1 });
  await authenticate(fixture.authenticator, signedHeaders());
  const secondHeaders = signedHeaders({ nonce: 'nonce-000000000002' });

  await assert.rejects(
    authenticate(fixture.authenticator, secondHeaders),
    (error) => error instanceof HttpError
      && error.code === 'RATE_LIMITED'
      && Number(error.headers['retry-after']) > 0
      && error.headers['x-rate-limit-limit'] === '1'
      && error.headers['x-rate-limit-remaining'] === '0'
      && Number(error.headers['x-rate-limit-reset']) > 0,
  );
});

test('audit and last-used write failures never break a valid authentication result', async () => {
  const record = {
    id: 8,
    client_id: 'nav-site-01',
    display_name: 'Navigation site 01',
    status: 'active',
    rate_limit_per_minute: 10,
  };
  const logged = [];
  const authenticator = new RequestAuthenticator({
    clientRepository: {
      async findAuthenticationRecord() { return record; },
      touchLastUsed() { throw new Error('write unavailable'); },
    },
    clientService: { decryptAuthenticationSecret: () => secret },
    replayGuard: new ReplayGuard({ ttlSeconds: 300, maxEntries: 1_000, now: () => nowMs }),
    rateLimiter: new ClientRateLimiter({ now: () => nowMs }),
    auditRepository: { recordAudit() { throw new Error('audit unavailable'); } },
    logger: { error(event) { logged.push(event); } },
    clockSkewSeconds: 60,
    now: () => nowMs,
  });

  const result = await authenticate(authenticator, signedHeaders());
  await assert.rejects(
    authenticate(authenticator, signedHeaders()),
    (error) => error instanceof HttpError && error.code === 'REPLAY_DETECTED',
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(result.client.client_id, 'nav-site-01');
  assert.ok(logged.includes('client_last_used_update_failed'));
  assert.ok(logged.includes('authentication_audit_failed'));
});
