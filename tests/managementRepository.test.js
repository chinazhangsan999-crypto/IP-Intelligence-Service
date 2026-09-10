import assert from 'node:assert/strict';
import test from 'node:test';
import { ManagementRepository } from '../src/repositories/ManagementRepository.js';

test('data update advisory lock keeps its PostgreSQL connection until release', async () => {
  const queries = [];
  let releases = 0;
  const client = {
    async query(sql) {
      queries.push(sql);
      return { rows: [{ acquired: true }] };
    },
    release() { releases += 1; },
  };
  const repository = new ManagementRepository({ async connect() { return client; } });

  const unlock = await repository.acquireDataUpdateLock();
  assert.equal(typeof unlock, 'function');
  assert.equal(releases, 0);
  await unlock();
  await unlock();
  assert.equal(queries.length, 2);
  assert.equal(releases, 1);
});

test('data update advisory lock releases the connection immediately when unavailable', async () => {
  let releases = 0;
  const repository = new ManagementRepository({
    async connect() {
      return {
        async query() { return { rows: [{ acquired: false }] }; },
        release() { releases += 1; },
      };
    },
  });

  assert.equal(await repository.acquireDataUpdateLock(), null);
  assert.equal(releases, 1);
});

test('data source refresh preserves the last checksum when no new checksum is available', async () => {
  let queryText = '';
  const repository = new ManagementRepository({
    async query(sql) {
      queryText = sql;
      return { rows: [{}] };
    },
  });

  await repository.upsertDataSource({
    id: 'tor-exit',
    status: 'ready',
    required: false,
    version: 'test',
    fileChecksum: null,
    updatedAt: null,
    expiresAt: null,
    lastError: null,
  });

  assert.match(
    queryText,
    /file_checksum = COALESCE\(EXCLUDED\.file_checksum, data_source_versions\.file_checksum\)/,
  );
});
