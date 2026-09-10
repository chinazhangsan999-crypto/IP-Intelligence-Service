import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashAdminPassword,
  validateAdminPassword,
  validateAdminUsername,
  verifyAdminPassword,
} from '../src/security/adminPassword.js';

test('administrator passwords are salted and verified with scrypt', async () => {
  const first = await hashAdminPassword('a-strong-admin-password');
  const second = await hashAdminPassword('a-strong-admin-password');
  assert.equal(await verifyAdminPassword('a-strong-admin-password', first.passwordHash, first.passwordSalt), true);
  assert.equal(await verifyAdminPassword('wrong-password', first.passwordHash, first.passwordSalt), false);
  assert.notDeepEqual(first.passwordHash, second.passwordHash);
});

test('administrator credential validation enforces bounded safe inputs', () => {
  assert.equal(validateAdminUsername('admin.main'), true);
  assert.equal(validateAdminUsername('bad account'), false);
  assert.equal(validateAdminPassword('twelve-chars!'), true);
  assert.equal(validateAdminPassword('short'), false);
});
