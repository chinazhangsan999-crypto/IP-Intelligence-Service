import {
  decryptClientSecret,
  encryptClientSecret,
  generateClientSecret,
} from '../security/clientSecretCrypto.js';

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,63}$/;

export class ApiClientService {
  constructor(repository, masterKeyHex) {
    this.repository = repository;
    this.masterKeyHex = masterKeyHex;
  }

  async createClient({ clientId, displayName, rateLimitPerMinute = 600 }) {
    if (!CLIENT_ID_PATTERN.test(clientId || '')) {
      throw new Error('clientId must match ^[a-z0-9][a-z0-9_-]{2,63}$');
    }
    if (!displayName || typeof displayName !== 'string') {
      throw new Error('displayName is required');
    }
    if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute <= 0) {
      throw new Error('rateLimitPerMinute must be a positive integer');
    }

    const secret = generateClientSecret();
    const encryptedSecret = encryptClientSecret(secret, this.masterKeyHex, clientId);
    const client = await this.repository.create({
      clientId,
      displayName,
      encryptedSecret,
      rateLimitPerMinute,
    });

    return { client, secret };
  }

  async rotateClientSecret(clientId) {
    const secret = generateClientSecret();
    const encryptedSecret = encryptClientSecret(secret, this.masterKeyHex, clientId);
    const client = await this.repository.rotateSecret(clientId, encryptedSecret);
    return client ? { client, secret } : null;
  }

  async disableClient(clientId) {
    return this.repository.disable(clientId);
  }

  decryptAuthenticationSecret(record) {
    return decryptClientSecret({
      ciphertext: record.secret_ciphertext,
      iv: record.secret_iv,
      authTag: record.secret_auth_tag,
    }, this.masterKeyHex, record.client_id);
  }
}
