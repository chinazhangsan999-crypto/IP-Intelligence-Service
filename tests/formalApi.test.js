import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadiness } from '../src/readiness.js';
import { createHttpServer } from '../src/server.js';
import { ClientRateLimiter } from '../src/security/ClientRateLimiter.js';
import { createRequestSignature } from '../src/security/hmac.js';
import { ReplayGuard } from '../src/security/ReplayGuard.js';
import { RequestAuthenticator } from '../src/security/RequestAuthenticator.js';
import { IpLookupService } from '../src/services/IpLookupService.js';

const logger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

function provider(id, record) {
  return {
    id,
    lookup() { return { available: true, record }; },
    publicState() { return { id, required: true, ready: true, status: 'ready', version: 'test' }; },
  };
}

test('formal lookup accepts a signed batch and rejects replay of the same nonce', async () => {
  const secret = 'formal-api-test-secret';
  const now = Date.now();
  const record = {
    id: 17,
    client_id: 'nav-formal-test',
    display_name: 'Formal API test',
    status: 'active',
    rate_limit_per_minute: 60,
  };
  const authenticator = new RequestAuthenticator({
    clientRepository: {
      async findAuthenticationRecord(clientId) { return clientId === record.client_id ? record : null; },
      async touchLastUsed() {},
    },
    clientService: { decryptAuthenticationSecret() { return secret; } },
    replayGuard: new ReplayGuard({ ttlSeconds: 300, maxEntries: 1_000, now: () => now }),
    rateLimiter: new ClientRateLimiter({ now: () => now }),
    auditRepository: null,
    logger,
    clockSkewSeconds: 60,
    now: () => now,
  });
  const cityProvider = provider('dbip-city', {
    country: { iso_code: 'AU', names: { en: 'Australia', 'zh-CN': '澳大利亚' } },
  });
  const asnProvider = provider('dbip-asn', {
    autonomous_system_number: 13335,
    autonomous_system_organization: 'Cloudflare, Inc.',
  });
  const readiness = createReadiness([cityProvider.publicState(), asnProvider.publicState()]);
  const server = createHttpServer({
    config: {
      serviceName: 'ip-intelligence-service',
      security: { maxBodyBytes: 32_768 },
      http: { requestTimeoutMs: 10_000, headersTimeoutMs: 10_000, keepAliveTimeoutMs: 5_000 },
    },
    logger,
    readiness,
    authenticator,
    lookupService: new IpLookupService({ cityProvider, asnProvider }),
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const rawBody = Buffer.from(JSON.stringify({ ips: ['1.1.1.1'] }));
  const timestamp = String(Math.floor(now / 1_000));
  const nonce = 'formal-api-nonce-0001';
  const signature = createRequestSignature(secret, {
    method: 'POST', requestTarget: '/v1/ip/lookup', timestamp, nonce, rawBody,
  });
  const headers = {
    'content-type': 'application/json',
    'x-client-id': record.client_id,
    'x-timestamp': timestamp,
    'x-nonce': nonce,
    'x-signature': signature,
  };

  try {
    const response = await fetch(`${baseUrl}/v1/ip/lookup`, { method: 'POST', headers, body: rawBody });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.code, 'OK');
    assert.equal(result.data[0].country_name, '澳大利亚');
    assert.equal(result.data[0].asn, 13335);
    assert.equal(response.headers.get('x-rate-limit-limit'), '60');
    assert.equal(response.headers.get('x-rate-limit-remaining'), '59');

    const replay = await fetch(`${baseUrl}/v1/ip/lookup`, { method: 'POST', headers, body: rawBody });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).code, 'REPLAY_DETECTED');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
