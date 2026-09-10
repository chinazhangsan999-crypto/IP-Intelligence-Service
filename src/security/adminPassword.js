import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = Object.freeze({ N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export function validateAdminUsername(value) {
  if (typeof value !== 'string') return false;
  return /^[A-Za-z0-9_.-]{3,64}$/.test(value.trim());
}

export function validateAdminPassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

export async function hashAdminPassword(password, salt = randomBytes(16)) {
  const passwordHash = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return { passwordHash: Buffer.from(passwordHash), passwordSalt: Buffer.from(salt) };
}

export async function verifyAdminPassword(password, passwordHash, passwordSalt) {
  if (!Buffer.isBuffer(passwordHash) || !Buffer.isBuffer(passwordSalt)) return false;
  const actual = Buffer.from(await scrypt(password, passwordSalt, KEY_LENGTH, SCRYPT_OPTIONS));
  return actual.length === passwordHash.length && timingSafeEqual(actual, passwordHash);
}
