import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const MIGRATION_LOCK_NAME = 'ip-intelligence-service:migrations';

function checksum(content) {
  const normalized = content.replace(/\r\n?/g, '\n');
  return createHash('sha256').update(normalized).digest('hex');
}

export async function runMigrations(pool, logger, migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK_NAME]);
    lockAcquired = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const filenames = (await readdir(migrationsDir))
      .filter((filename) => /^\d+_[a-z0-9_]+\.sql$/.test(filename))
      .sort();
    const appliedResult = await client.query('SELECT filename, checksum FROM schema_migrations');
    const applied = new Map(appliedResult.rows.map((row) => [row.filename, row.checksum]));

    for (const filename of filenames) {
      const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
      const currentChecksum = checksum(sql);

      if (applied.has(filename)) {
        if (applied.get(filename) !== currentChecksum) {
          throw new Error(`Applied migration checksum mismatch: ${filename}`);
        }
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [filename, currentChecksum],
        );
        await client.query('COMMIT');
        logger.info('migration_applied', { filename });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return { applied_count: filenames.filter((filename) => !applied.has(filename)).length };
  } finally {
    try {
      if (lockAcquired) {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK_NAME]);
      }
    } finally {
      client.release();
    }
  }
}
