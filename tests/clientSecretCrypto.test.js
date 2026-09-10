import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptClientSecret,
  encryptClientSecret,
  fingerprintClientSecret,
  generateClientSecret,
} from '../src/security/clientSecretCrypto.js';

const masterKey = 'ab'.repeat(32);

test('client secrets round-trip through authenticated encryption', () => {
  const secret = generateClientSecret();
  const encrypted = encryptClientSecret(secret, masterKey, 'nav-site-01');
  const decrypted = decryptClientSecret(encrypted, masterKey, 'nav-site-01');

  assert.equal(decrypted, secret);
  assert.notEqual(encrypted.ciphertext.toString('utf8'), secret);
  assert.equal(encrypted.iv.length, 12);
  assert.equal(encrypted.authTag.length, 16);
  assert.equal(encrypted.fingerprint, fingerprintClientSecret(secret));
});

test('encrypted secrets are bound to the client identity', () => {
  const encrypted = encryptClientSecret('secret-value', masterKey, 'nav-site-01');
  assert.throws(
    () => decryptClientSecret(encrypted, masterKey, 'nav-site-02'),
    /authenticate data|Unsupported state/i,
  );
});
