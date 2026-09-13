import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

  assert.equal(result.applied_count, 5);
  assert.ok(statements.some((entry) => entry.sql === 'BEGIN'));
  assert.ok(statements.some((entry) => entry.sql === 'COMMIT'));
  assert.ok(statements.some((entry) => entry.sql.includes('CREATE TABLE api_clients')));
  assert.ok(statements.some((entry) => entry.sql.includes('CREATE TABLE IF NOT EXISTS admin_users')));
  assert.ok(statements.some((entry) => entry.sql.includes('CREATE TABLE data_source_configs')));
  assert.ok(statements.some((entry) => entry.sql.includes('ADD COLUMN source_id')));
  assert.equal(statements.at(-1).sql, 'RELEASE');
});

test('migrator treats LF and CRLF migration content as the same SQL', async () => {
  const migrationsDir = await mkdtemp(path.join(tmpdir(), 'ip-migrations-'));
  const filename = '001_line_endings.sql';
  const lfSql = 'CREATE TABLE example (\n  id INTEGER PRIMARY KEY\n);\n';
  await writeFile(path.join(migrationsDir, filename), lfSql.replaceAll('\n', '\r\n'));
  const storedChecksum = createHash('sha256').update(lfSql).digest('hex');
  const client = {
    async query(sql) {
      if (sql === 'SELECT filename, checksum FROM schema_migrations') {
        return { rows: [{ filename, checksum: storedChecksum }] };
      }
      return { rows: [] };
    },
    release() {},
  };

  try {
    const result = await runMigrations(
      { async connect() { return client; } },
      { info() {} },
      migrationsDir,
    );
    assert.equal(result.applied_count, 0);
  } finally {
    await rm(migrationsDir, { recursive: true, force: true });
  }
});
