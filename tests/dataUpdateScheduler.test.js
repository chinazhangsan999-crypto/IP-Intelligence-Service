import assert from 'node:assert/strict';
import test from 'node:test';
import { DataUpdateScheduler } from '../src/update/DataUpdateScheduler.js';
import { DATA_SOURCE_UNITS } from '../src/data/dataSourceCatalog.js';

const logger = Object.freeze({ info() {}, error() {} });

function scheduler(overrides = {}) {
  return new DataUpdateScheduler({
    enabled: true,
    intervalMs: 1_000,
    startupDelayMs: 100,
    cwd: 'C:\\service',
    logger,
    reloadSources: async () => [{ id: 'dbip-city', status: 'ready', version: 'test' }],
    execute: async (scriptPath) => ({ scriptPath }),
    ...overrides,
  });
}

test('successful automatic update runs every default automatic source, reloads once and records the job', async () => {
  const calls = [];
  const finished = [];
  const metricStatuses = [];
  const instance = scheduler({
    execute: async (scriptPath) => { calls.push(scriptPath); return { updated: true }; },
    repository: {
      async startUpdateJob() { return { id: 9 }; },
      async finishUpdateJob(id, result) { finished.push({ id, ...result }); },
    },
    metrics: { observeDataUpdate(status) { metricStatuses.push(status); } },
  });

  const result = await instance.runCycle();
  assert.equal(result.status, 'succeeded');
  assert.equal(calls.length, DATA_SOURCE_UNITS.filter((unit) => unit.defaultEnabled && unit.defaultAutoUpdate).length);
  assert.equal(finished[0].status, 'succeeded');
  assert.deepEqual(metricStatuses, ['succeeded']);
  assert.equal(instance.snapshot().last_run.status, 'succeeded');
});

test('one failed source does not prevent a successful source from being hot reloaded', async () => {
  let reloads = 0;
  const instance = scheduler({
    execute: async (scriptPath) => {
      if (scriptPath.endsWith('update-dbip-data.js')) throw new Error('DB-IP unavailable');
      return { updated: true };
    },
    reloadSources: async () => { reloads += 1; return []; },
  });

  const result = await instance.runCycle();
  assert.equal(result.status, 'failed');
  assert.equal(reloads, 1);
  assert.equal(result.details.results.open.status, 'succeeded');
});

test('IP2Proxy updater runs only when its own automatic update setting is enabled', async () => {
  const calls = [];
  const instance = scheduler({
    ip2ProxyAutoUpdateEnabled: true,
    execute: async (scriptPath) => { calls.push(scriptPath); return { updated: false }; },
  });

  await instance.runCycle();
  assert.equal(calls.length, DATA_SOURCE_UNITS.filter((unit) => unit.defaultEnabled && (unit.defaultAutoUpdate || unit.id === 'ip2proxy')).length);
  assert.equal(calls.some((scriptPath) => scriptPath.endsWith('update-ip2proxy-data.js')), true);
});

test('SAPICS updater runs only when daily catalogue updates are enabled', async () => {
  const calls = [];
  const instance = scheduler({
    sapicsAutoUpdateEnabled: true,
    execute: async (scriptPath) => { calls.push(scriptPath); return { status: 'updated', updated: true }; },
  });

  await instance.runCycle();
  assert.equal(calls.some((path) => path.endsWith('update-sapics-data.js')), true);
});

test('overlapping update cycles are rejected', async () => {
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const instance = scheduler({ execute: async () => waiting });
  const first = instance.runCycle();
  const second = await instance.runCycle();
  assert.deepEqual(second, { started: false, reason: 'not_available' });
  release({ updated: false });
  await first;
});

test('database advisory lock prevents a second service instance from updating', async () => {
  let executions = 0;
  const instance = scheduler({
    execute: async () => { executions += 1; },
    repository: { async acquireDataUpdateLock() { return null; } },
  });

  const result = await instance.runCycle();
  assert.deepEqual(result, { started: false, reason: 'another_instance_updating' });
  assert.equal(executions, 0);
});

test('manual single-source download runs only the requested updater with force mode', async () => {
  const calls = [];
  const instance = scheduler({
    execute: async (scriptPath, cwd, signal, args) => {
      calls.push({ scriptPath, cwd, signal, args });
      return { status: 'updated', updated: true };
    },
  });

  const result = await instance.runCycle({ unitIds: ['sapics'], force: true, trigger: 'manual' });

  assert.equal(result.status, 'succeeded');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].scriptPath.endsWith('update-sapics-data.js'), true);
  assert.deepEqual(calls[0].args, ['--force']);
});

test('forced all-source download passes force to every enabled updater and validates samples', async () => {
  const calls = [];
  let validations = 0;
  const instance = scheduler({
    execute: async (scriptPath, cwd, signal, args) => {
      calls.push({ scriptPath, args });
      return { status: 'updated', updated: true };
    },
    validateSources: async () => {
      validations += 1;
      return { passed: true, resolved_count: 4, sample_count: 4 };
    },
  });

  const result = await instance.runCycle({ force: true, trigger: 'manual', validateAfterUpdate: true });

  assert.equal(result.status, 'succeeded');
  assert.equal(calls.length, DATA_SOURCE_UNITS.filter((unit) => unit.defaultEnabled).length);
  assert.equal(calls.every((call) => call.args.includes('--force')), true);
  assert.equal(validations, 1);
  assert.equal(result.details.validation.passed, true);
});

test('automatic update respects stored source enablement and interval', async () => {
  const calls = [];
  const instance = scheduler({
    repository: {
      async listDataSourceConfigs() {
        const overrides = new Map([
          { source_id: 'dbip', enabled: true, auto_update_enabled: true, interval_hours: 24, last_update_at: new Date().toISOString() },
          { source_id: 'open', enabled: true, auto_update_enabled: true, interval_hours: 1, last_update_at: null },
          { source_id: 'ip2proxy', enabled: false, auto_update_enabled: true, interval_hours: 1, last_update_at: null },
          { source_id: 'sapics', enabled: true, auto_update_enabled: false, interval_hours: 1, last_update_at: null },
        ].map((item) => [item.source_id, item]));
        return DATA_SOURCE_UNITS.map((unit) => overrides.get(unit.id) || {
          source_id: unit.id,
          enabled: unit.defaultEnabled,
          auto_update_enabled: false,
          interval_hours: unit.defaultIntervalHours,
          last_update_at: null,
        });
      },
    },
    execute: async (scriptPath) => { calls.push(scriptPath); return { updated: false }; },
  });

  await instance.runCycle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endsWith('update-open-data.js'), true);
});

test('successful evidence downloads persist member version and error metadata', async () => {
  const saved = [];
  const instance = scheduler({
    repository: {
      async listDataSourceConfigs() { return []; },
      async upsertDataSource(source) { saved.push(source); },
      async markDataSourceUpdate() {},
    },
    execute: async () => ({
      status: 'updated',
      updated: true,
      sources: [{ id: 'rdap-ipv4', version: '2026-09-13', sha256: 'a'.repeat(64), bytes: 100, records: 5 }],
    }),
  });

  await instance.runCycle({ unitIds: ['rdap'], force: true, trigger: 'manual' });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, 'rdap-ipv4');
  assert.equal(saved[0].fileChecksum, 'a'.repeat(64));
  assert.deepEqual(saved[0].metadata, { file: null, bytes: 100, records: 5, license: null });
});
