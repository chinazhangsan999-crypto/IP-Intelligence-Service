import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CloudRangeProvider } from '../src/providers/CloudRangeProvider.js';
import { Ip2ProxyProvider } from '../src/providers/Ip2ProxyProvider.js';
import { TorExitProvider } from '../src/providers/TorExitProvider.js';

test('cloud and Tor providers load local files and return negative evidence when not matched', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'optional-provider-test-'));
  try {
    const cloudPath = path.join(directory, 'cloud.json');
    const torPath = path.join(directory, 'tor.txt');
    await fs.writeFile(cloudPath, JSON.stringify({
      version: 'test-v1',
      ranges: [{ cidr: '1.1.1.0/24', provider: 'test-cloud', network_type: 'hosting' }],
    }));
    await fs.writeFile(torPath, '# updated_at=test-v1\n1.1.1.1\n');
    const cloud = await CloudRangeProvider.load(cloudPath);
    const tor = await TorExitProvider.load(torPath);

    assert.equal(cloud.lookup('1.1.1.1').matches[0].provider, 'test-cloud');
    assert.deepEqual(cloud.lookup('8.8.8.8'), { available: true, matches: [] });
    assert.deepEqual(tor.lookup('1.1.1.1'), { available: true, matched: true });
    assert.deepEqual(tor.lookup('8.8.8.8'), { available: true, matched: false });
    assert.equal(cloud.publicState().status, 'ready');
    assert.equal(tor.publicState().status, 'ready');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('optional network lists report stale without becoming unavailable', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'optional-provider-stale-test-'));
  try {
    const cloudPath = path.join(directory, 'cloud.json');
    const torPath = path.join(directory, 'tor.txt');
    await fs.writeFile(cloudPath, JSON.stringify({
      version: 'old',
      updated_at: '2026-01-01T00:00:00.000Z',
      ranges: [{ cidr: '1.1.1.0/24', provider: 'test-cloud', network_type: 'hosting' }],
    }));
    await fs.writeFile(torPath, '# updated_at=2026-01-01T00:00:00.000Z\n1.1.1.1\n');
    const now = () => Date.parse('2026-02-01T00:00:00.000Z');
    const [cloud, tor] = await Promise.all([
      CloudRangeProvider.load(cloudPath, now),
      TorExitProvider.load(torPath, now),
    ]);
    assert.equal(cloud.publicState().status, 'stale');
    assert.equal(cloud.publicState().ready, true);
    assert.equal(tor.publicState().status, 'stale');
    assert.equal(tor.publicState().ready, true);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('missing optional provider files remain unavailable without throwing', async () => {
  const missing = path.join(os.tmpdir(), `missing-${Date.now()}`);
  const [cloud, tor, proxy] = await Promise.all([
    CloudRangeProvider.load(`${missing}.json`),
    TorExitProvider.load(`${missing}.txt`),
    Ip2ProxyProvider.load(`${missing}.bin`),
  ]);
  assert.equal(cloud.publicState().ready, false);
  assert.equal(tor.publicState().ready, false);
  assert.equal(proxy.publicState().ready, false);
});
