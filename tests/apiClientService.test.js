import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClientService } from '../src/services/ApiClientService.js';

const masterKey = 'cd'.repeat(32);

test('ApiClientService returns a new secret once and persists only encrypted material', async () => {
  let stored;
  const repository = {
    async create(input) {
      stored = input;
      return { client_id: input.clientId, secret_version: 1 };
    },
  };
  const service = new ApiClientService(repository, masterKey);
  const result = await service.createClient({
    clientId: 'nav-site-01',
    displayName: 'Navigation site 01',
  });

  assert.equal(result.client.client_id, 'nav-site-01');
  assert.equal(typeof result.secret, 'string');
  assert.ok(result.secret.length >= 40);
  assert.equal('secret' in stored, false);
  assert.equal(Buffer.isBuffer(stored.encryptedSecret.ciphertext), true);
  assert.equal(service.decryptAuthenticationSecret({
    client_id: 'nav-site-01',
    secret_ciphertext: stored.encryptedSecret.ciphertext,
    secret_iv: stored.encryptedSecret.iv,
    secret_auth_tag: stored.encryptedSecret.authTag,
  }), result.secret);
});

test('ApiClientService rejects invalid client metadata', async () => {
  const service = new ApiClientService({}, masterKey);
  await assert.rejects(
    service.createClient({ clientId: 'A', displayName: 'Invalid' }),
    /clientId must match/,
  );
});

test('ApiClientService rotates and disables an existing client', async () => {
  let rotatedSecret;
  const repository = {
    async rotateSecret(clientId, encryptedSecret) {
      rotatedSecret = encryptedSecret;
      return { client_id: clientId, secret_version: 2 };
    },
    async disable(clientId) {
      return { client_id: clientId, status: 'disabled' };
    },
  };
  const service = new ApiClientService(repository, masterKey);

  const rotated = await service.rotateClientSecret('nav-site-01');
  const disabled = await service.disableClient('nav-site-01');

  assert.equal(rotated.client.secret_version, 2);
  assert.equal(typeof rotated.secret, 'string');
  assert.equal(Buffer.isBuffer(rotatedSecret.ciphertext), true);
  assert.equal(disabled.status, 'disabled');
});
