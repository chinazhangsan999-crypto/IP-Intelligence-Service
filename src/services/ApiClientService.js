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
    if (typeof displayName !== 'string' || !displayName.trim() || displayName.trim().length > 128) {
      throw new Error('displayName must contain between 1 and 128 characters');
    }
    if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute <= 0 || rateLimitPerMinute > 100_000) {
      throw new Error('rateLimitPerMinute must be an integer between 1 and 100000');
    }

    const secret = generateClientSecret();
    const encryptedSecret = encryptClientSecret(secret, this.masterKeyHex, clientId);
    const client = await this.repository.create({
      clientId,
      displayName: displayName.trim(),
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

  async setClientStatus(clientId, status) {
    if (!['active', 'disabled'].includes(status)) throw new Error('status must be active or disabled');
    return this.repository.setStatus(clientId, status);
  }

  async listClients() {
    return this.repository.list();
  }

  decryptAuthenticationSecret(record) {
    return decryptClientSecret({
      ciphertext: record.secret_ciphertext,
      iv: record.secret_iv,
      authTag: record.secret_auth_tag,
    }, this.masterKeyHex, record.client_id);
  }
}
