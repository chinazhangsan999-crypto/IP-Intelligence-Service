export class AdminAuthRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async countUsers() {
    const result = await this.pool.query('SELECT COUNT(*)::integer AS count FROM admin_users');
    return result.rows[0].count;
  }

  async createUser({ username, normalizedUsername, passwordHash, passwordSalt }) {
    const result = await this.pool.query(
      `INSERT INTO admin_users (username, normalized_username, password_hash, password_salt)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, created_at, updated_at`,
      [username, normalizedUsername, passwordHash, passwordSalt],
    );
    return result.rows[0];
  }

  async findUserByNormalizedUsername(normalizedUsername) {
    const result = await this.pool.query(
      `SELECT id, username, normalized_username, password_hash, password_salt
         FROM admin_users
        WHERE normalized_username = $1`,
      [normalizedUsername],
    );
    return result.rows[0] || null;
  }

  async createSession({ tokenHash, csrfTokenHash, adminUserId, expiresAt }) {
    await this.pool.query(
      `INSERT INTO admin_sessions (token_hash, csrf_token_hash, admin_user_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenHash, csrfTokenHash, adminUserId, expiresAt],
    );
  }

  async findActiveSession(tokenHash) {
    const result = await this.pool.query(
      `SELECT s.token_hash, s.csrf_token_hash, s.admin_user_id, s.expires_at,
              u.username, u.normalized_username
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.admin_user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > NOW()`,
      [tokenHash],
    );
    return result.rows[0] || null;
  }

  async touchSession(tokenHash) {
    await this.pool.query(
      `UPDATE admin_sessions SET last_seen_at = NOW()
        WHERE token_hash = $1 AND last_seen_at < NOW() - INTERVAL '5 minutes'`,
      [tokenHash],
    );
  }

  async updateSessionCsrf(tokenHash, csrfTokenHash) {
    await this.pool.query(
      'UPDATE admin_sessions SET csrf_token_hash = $2 WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash, csrfTokenHash],
    );
  }

  async revokeSession(tokenHash) {
    await this.pool.query(
      'UPDATE admin_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
      [tokenHash],
    );
  }

  async updateCredentials({ userId, username, normalizedUsername, passwordHash = null, passwordSalt = null }) {
    const result = await this.pool.query(
      `UPDATE admin_users
          SET username = $2,
              normalized_username = $3,
              password_hash = COALESCE($4, password_hash),
              password_salt = COALESCE($5, password_salt),
              password_changed_at = CASE WHEN $4::bytea IS NULL THEN password_changed_at ELSE NOW() END,
              updated_at = NOW()
        WHERE id = $1
      RETURNING id, username, updated_at`,
      [userId, username, normalizedUsername, passwordHash, passwordSalt],
    );
    return result.rows[0] || null;
  }

  async revokeAllUserSessions(userId) {
    await this.pool.query(
      'UPDATE admin_sessions SET revoked_at = NOW() WHERE admin_user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }

  async deleteExpiredSessions() {
    await this.pool.query('DELETE FROM admin_sessions WHERE expires_at <= NOW() OR revoked_at < NOW() - INTERVAL \'7 days\'');
  }
}
