import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http/HttpError.js';
import {
  hashAdminPassword,
  validateAdminPassword,
  validateAdminUsername,
  verifyAdminPassword,
} from '../security/adminPassword.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedUsername(username) {
  return username.trim().toLowerCase();
}

export class AdminAuthService {
  constructor(repository, { now = Date.now } = {}) {
    this.repository = repository;
    this.now = now;
    this.dummyPassword = hashAdminPassword(randomBytes(24).toString('base64url'));
  }

  async login(username, password) {
    const normalized = typeof username === 'string' ? normalizedUsername(username) : '';
    const user = normalized ? await this.repository.findUserByNormalizedUsername(normalized) : null;
    const dummy = user ? null : await this.dummyPassword;
    const valid = typeof password === 'string' && await verifyAdminPassword(
      password,
      user?.password_hash || dummy.passwordHash,
      user?.password_salt || dummy.passwordSalt,
    );
    if (!valid) throw new HttpError(401, 'INVALID_CREDENTIALS', '账号或密码错误');

    const sessionToken = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(this.now() + SESSION_TTL_MS);
    await this.repository.createSession({
      tokenHash: sha256(sessionToken),
      csrfTokenHash: sha256(csrfToken),
      adminUserId: user.id,
      expiresAt,
    });
    return { sessionToken, csrfToken, expiresAt, user: { id: user.id, username: user.username } };
  }

  async authenticate(sessionToken) {
    if (typeof sessionToken !== 'string' || sessionToken.length !== 64) return null;
    const tokenHash = sha256(sessionToken);
    const session = await this.repository.findActiveSession(tokenHash);
    if (!session) return null;
    void this.repository.touchSession(tokenHash).catch(() => {});
    return { ...session, tokenHash };
  }

  verifyCsrf(session, csrfToken) {
    if (!session || typeof csrfToken !== 'string') return false;
    const actual = Buffer.from(sha256(csrfToken), 'utf8');
    const expected = Buffer.from(session.csrf_token_hash, 'utf8');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  async refreshCsrf(session) {
    const csrfToken = randomBytes(32).toString('hex');
    await this.repository.updateSessionCsrf(session.tokenHash, sha256(csrfToken));
    return csrfToken;
  }

  async logout(session) {
    if (session?.tokenHash) await this.repository.revokeSession(session.tokenHash);
  }

  async changeCredentials(session, { currentPassword, username, newPassword }) {
    const user = await this.repository.findUserByNormalizedUsername(session.normalized_username);
    if (!user || typeof currentPassword !== 'string'
      || !await verifyAdminPassword(currentPassword, user.password_hash, user.password_salt)) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', '当前密码错误');
    }

    const nextUsername = typeof username === 'string' ? username.trim() : user.username;
    if (!validateAdminUsername(nextUsername)) {
      throw new HttpError(422, 'INVALID_USERNAME', '账号需为 3 至 64 位字母、数字、点、短横线或下划线');
    }
    if (newPassword && !validateAdminPassword(newPassword)) {
      throw new HttpError(422, 'INVALID_PASSWORD', '新密码长度需为 12 至 128 个字符');
    }
    if (nextUsername === user.username && !newPassword) {
      throw new HttpError(422, 'NO_CHANGES', '账号或密码没有变化');
    }

    const password = newPassword ? await hashAdminPassword(newPassword) : {};
    try {
      await this.repository.updateCredentials({
        userId: user.id,
        username: nextUsername,
        normalizedUsername: normalizedUsername(nextUsername),
        passwordHash: password.passwordHash || null,
        passwordSalt: password.passwordSalt || null,
      });
    } catch (error) {
      if (error?.code === '23505') throw new HttpError(409, 'USERNAME_EXISTS', '该账号已存在');
      throw error;
    }
    await this.repository.revokeAllUserSessions(user.id);
  }
}
