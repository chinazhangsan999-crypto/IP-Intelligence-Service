import pg from 'pg';

const { Pool } = pg;

function sslForMode(mode) {
  if (mode === 'disable') return undefined;
  return { rejectUnauthorized: mode === 'verify-full' };
}

export function createPostgresPool(databaseConfig, logger) {
  if (!databaseConfig.enabled) return null;

  const pool = new Pool({
    connectionString: databaseConfig.url,
    max: databaseConfig.poolMax,
    idleTimeoutMillis: databaseConfig.idleTimeoutMs,
    connectionTimeoutMillis: databaseConfig.connectionTimeoutMs,
    ssl: sslForMode(databaseConfig.sslMode),
    application_name: 'ip-intelligence-service',
  });

  pool.on('error', (error) => {
    logger.error('postgres_idle_client_error', { error });
  });

  return pool;
}

export async function verifyPostgres(pool) {
  const result = await pool.query('SELECT current_database() AS database_name, NOW() AS checked_at');
  return result.rows[0];
}
