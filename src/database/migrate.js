import { loadConfig } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { runMigrations } from './migrator.js';
import { createPostgresPool, verifyPostgres } from './pool.js';

async function main() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });

  if (!config.database.enabled) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const pool = createPostgresPool(config.database, logger);

  try {
    await verifyPostgres(pool);
    const result = await runMigrations(pool, logger);
    logger.info('migrations_completed', result);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  createLogger().error('migration_failed', { error });
  process.exitCode = 1;
}
