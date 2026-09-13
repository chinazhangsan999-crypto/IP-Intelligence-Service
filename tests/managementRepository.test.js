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

test('data source configuration edits only persist operational fields', async () => {
  let values = null;
  const repository = new ManagementRepository({
    async query(_sql, parameters) {
      values = parameters;
      return { rows: [{ source_id: parameters[0] }] };
    },
  });

  const result = await repository.updateDataSourceConfig('dbip', {
    displayName: 'DB-IP 基础库', enabled: true, autoUpdateEnabled: true, intervalHours: 24,
  }, 7);

  assert.equal(result.source_id, 'dbip');
  assert.deepEqual(values, ['dbip', 'DB-IP 基础库', true, true, 24, 7]);
});

test('classification rules retain their associated source for management and audit', async () => {
  let values = null;
  const repository = new ManagementRepository({
    async query(_sql, parameters) {
      values = parameters;
      return { rows: [{ id: 1, source_id: parameters[1] }] };
    },
  });
  const result = await repository.saveClassificationRule({
    name: 'RIPE 争议覆盖', sourceId: 'ripe-ris', priority: 900,
    matchType: 'asn', matchValue: '64500', networkType: 'business',
    confidence: 'high', flags: {}, enabled: true,
  });
  assert.equal(result.source_id, 'ripe-ris');
  assert.equal(values[1], 'ripe-ris');
});
