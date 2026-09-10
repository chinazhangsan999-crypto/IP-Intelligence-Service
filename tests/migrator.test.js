import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runMigrations } from '../src/database/migrator.js';

test('initial migration defines every management table without a raw IP column', async () => {
  const sql = await readFile(
    new URL('../src/database/migrations/001_management_schema.sql', import.meta.url),
    'utf8',
  );
  const tables = [
    'api_clients',
    'api_usage_hourly',
    'data_source_versions',
    'network_classification_rules',
    'update_jobs',
    'audit_logs',
    'lookup_feedback',
  ];

  for (const table of tables) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}\\b`));
  }
  assert.doesNotMatch(sql, /\braw_ip\b/i);
});

test('migrator applies an unapplied migration transactionally', async () => {
  const statements = [];
  const client = {
    async query(sql, values) {
      statements.push({ sql, values });
      if (sql === 'SELECT filename, checksum FROM schema_migrations') return { rows: [] };
      return { rows: [] };
    },
    release() { statements.push({ sql: 'RELEASE' }); },
  };
  const pool = { async connect() { return client; } };
  const logger = { info() {} };

  const result = await runMigrations(pool, logger);

  assert.equal(result.applied_count, 2);
  assert.ok(statements.some((entry) => entry.sql === 'BEGIN'));
  assert.ok(statements.some((entry) => entry.sql === 'COMMIT'));
  assert.ok(statements.some((entry) => entry.sql.includes('CREATE TABLE api_clients')));
  assert.ok(statements.some((entry) => entry.sql.includes('CREATE TABLE IF NOT EXISTS admin_users')));
  assert.equal(statements.at(-1).sql, 'RELEASE');
});
