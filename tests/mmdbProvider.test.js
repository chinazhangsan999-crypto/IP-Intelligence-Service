import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MmdbProvider } from '../src/providers/MmdbProvider.js';

test('missing MMDB files produce an unavailable provider without exposing paths', async () => {
  const provider = await MmdbProvider.load({
    id: 'dbip-city',
    filePath: path.join(os.tmpdir(), `missing-${Date.now()}.mmdb`),
  });
  assert.deepEqual(provider.publicState(), {
    id: 'dbip-city',
    required: true,
    ready: false,
    status: 'unavailable',
    version: null,
    updated_at: null,
    expires_at: null,
    message: 'Database file is missing',
  });
});

test('loaded MMDB metadata becomes a public source state', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ip-mmdb-test-'));
  const filePath = path.join(directory, 'sample.mmdb');
  await fs.writeFile(filePath, 'fixture');
  try {
    const reader = {
      metadata: { buildEpoch: new Date('2026-09-01T00:00:00.000Z') },
      get(ip) { return ip === '1.1.1.1' ? { found: true } : null; },
    };
    const provider = await MmdbProvider.load({
      id: 'dbip-city',
      filePath,
      openDatabase: async () => reader,
    });
    assert.equal(provider.publicState().ready, true);
    assert.equal(provider.publicState().version, '2026-09');
    assert.equal(provider.publicState().status, 'ready');
    assert.equal(provider.publicState().updated_at, '2026-09-01T00:00:00.000Z');
    assert.equal(provider.publicState().expires_at, '2026-10-16T00:00:00.000Z');
    assert.deepEqual(provider.lookup('1.1.1.1'), {
      available: true,
      record: { found: true },
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('loaded MMDB remains queryable but reports stale after its freshness window', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ip-mmdb-stale-test-'));
  const filePath = path.join(directory, 'sample.mmdb');
  await fs.writeFile(filePath, 'fixture');
  try {
    const provider = await MmdbProvider.load({
      id: 'dbip-city',
      filePath,
      openDatabase: async () => ({
        metadata: { buildEpoch: new Date('2026-01-01T00:00:00.000Z') },
        get() { return null; },
      }),
      now: () => Date.parse('2026-03-01T00:00:00.000Z'),
    });
    assert.equal(provider.publicState().ready, true);
    assert.equal(provider.publicState().status, 'stale');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
