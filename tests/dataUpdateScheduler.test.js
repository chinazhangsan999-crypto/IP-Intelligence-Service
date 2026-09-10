import assert from 'node:assert/strict';
import test from 'node:test';
import { DataUpdateScheduler } from '../src/update/DataUpdateScheduler.js';

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

test('successful automatic update runs both updaters, reloads once and records the job', async () => {
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
  assert.equal(calls.length, 2);
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
