export class ApiClientRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create({ clientId, displayName, encryptedSecret, rateLimitPerMinute }) {
    const result = await this.pool.query(
      `INSERT INTO api_clients (
         client_id, display_name, secret_ciphertext, secret_iv,
         secret_auth_tag, secret_fingerprint, rate_limit_per_minute
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, client_id, display_name, secret_fingerprint, secret_version,
                 status, rate_limit_per_minute, last_used_at, rotated_at,
                 created_at, updated_at`,
      [
        clientId,
        displayName,
        encryptedSecret.ciphertext,
        encryptedSecret.iv,
        encryptedSecret.authTag,
        encryptedSecret.fingerprint,
        rateLimitPerMinute,
      ],
    );
    return result.rows[0];
  }

  async findAuthenticationRecord(clientId) {
    const result = await this.pool.query(
      `SELECT id, client_id, display_name, secret_ciphertext, secret_iv,
              secret_auth_tag, secret_fingerprint, secret_version, status,
              rate_limit_per_minute, last_used_at, rotated_at, created_at, updated_at
         FROM api_clients
        WHERE client_id = $1`,
      [clientId],
    );
    return result.rows[0] || null;
  }

  async list() {
    const result = await this.pool.query(
      `SELECT id, client_id, display_name, secret_fingerprint, secret_version,
              status, rate_limit_per_minute, last_used_at, rotated_at,
              created_at, updated_at
         FROM api_clients
        ORDER BY created_at ASC`,
    );
    return result.rows;
  }

  async touchLastUsed(id) {
    await this.pool.query(
      'UPDATE api_clients SET last_used_at = NOW() WHERE id = $1',
      [id],
    );
  }

  async disable(clientId) {
    const result = await this.pool.query(
      `UPDATE api_clients
          SET status = 'disabled', updated_at = NOW()
        WHERE client_id = $1
      RETURNING id, client_id, display_name, secret_fingerprint, secret_version,
                status, rate_limit_per_minute, last_used_at, rotated_at,
                created_at, updated_at`,
      [clientId],
    );
    return result.rows[0] || null;
  }

  async rotateSecret(clientId, encryptedSecret) {
    const result = await this.pool.query(
      `UPDATE api_clients
          SET secret_ciphertext = $2,
              secret_iv = $3,
              secret_auth_tag = $4,
              secret_fingerprint = $5,
              secret_version = secret_version + 1,
              rotated_at = NOW(),
              updated_at = NOW()
        WHERE client_id = $1
      RETURNING id, client_id, display_name, secret_fingerprint, secret_version,
                status, rate_limit_per_minute, last_used_at, rotated_at,
                created_at, updated_at`,
      [
        clientId,
        encryptedSecret.ciphertext,
        encryptedSecret.iv,
        encryptedSecret.authTag,
        encryptedSecret.fingerprint,
      ],
    );
    return result.rows[0] || null;
  }
}
