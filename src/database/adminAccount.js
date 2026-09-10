import { randomBytes } from 'node:crypto';
import { loadConfig } from '../config.js';
import { AdminAuthRepository } from '../repositories/AdminAuthRepository.js';
import { hashAdminPassword, validateAdminUsername } from '../security/adminPassword.js';
import { createPostgresPool, verifyPostgres } from './pool.js';
import { runMigrations } from './migrator.js';

const logger = Object.freeze({ info() {}, warn() {}, error() {} });

async function main() {
  const username = (process.argv[2] || 'admin').trim();
  if (!validateAdminUsername(username)) throw new Error('Admin username must contain 3-64 letters, numbers, dots, hyphens, or underscores');
  const config = loadConfig();
  const pool = createPostgresPool(config.database, logger);
  if (!pool) throw new Error('PostgreSQL is not configured');
  try {
    await verifyPostgres(pool);
    await runMigrations(pool, logger);
    const repository = new AdminAuthRepository(pool);
    if (await repository.countUsers() > 0) throw new Error('An administrator already exists; change it from the admin console');
    const password = randomBytes(18).toString('base64url');
    const { passwordHash, passwordSalt } = await hashAdminPassword(password);
    await repository.createUser({
      username,
      normalizedUsername: username.toLowerCase(),
      passwordHash,
      passwordSalt,
    });
    process.stdout.write(`${JSON.stringify({ username, password })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
