import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function parseMasterKey(masterKeyHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex || '')) {
    throw new Error('Client secret master key must contain 64 hexadecimal characters');
  }
  return Buffer.from(masterKeyHex, 'hex');
}

export function generateClientSecret() {
  return randomBytes(32).toString('base64url');
}

export function fingerprintClientSecret(secret) {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function encryptClientSecret(secret, masterKeyHex, clientId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, parseMasterKey(masterKeyHex), iv);
  cipher.setAAD(Buffer.from(clientId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);

  return {
    ciphertext,
    iv,
    authTag: cipher.getAuthTag(),
    fingerprint: fingerprintClientSecret(secret),
  };
}

export function decryptClientSecret(encrypted, masterKeyHex, clientId) {
  const decipher = createDecipheriv(ALGORITHM, parseMasterKey(masterKeyHex), encrypted.iv);
  decipher.setAAD(Buffer.from(clientId, 'utf8'));
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString('utf8');
}
