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

test('cloud provider merges every installed official range file and ignores missing optional files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-cloud-provider-test-'));
  try {
    const base = path.join(directory, 'base.json');
    const extended = path.join(directory, 'extended.json');
    await fs.writeFile(base, JSON.stringify({ ranges: [{ cidr: '1.1.1.0/24', provider: 'base', network_type: 'hosting' }] }));
    await fs.writeFile(extended, JSON.stringify({ ranges: [{ cidr: '8.8.8.0/24', provider: 'extended', network_type: 'cdn' }] }));
    const provider = await CloudRangeProvider.load([base, extended, path.join(directory, 'missing.json')]);
    assert.equal(provider.lookup('1.1.1.1').matches[0].provider, 'base');
    assert.equal(provider.lookup('8.8.8.8').matches[0].provider, 'extended');
    assert.match(provider.publicState().version, /2 files \/ 2 ranges/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('Azure Public and China evidence remain distinguishable after range files are merged', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'azure-cloud-provider-test-'));
  try {
    const publicCloud = path.join(directory, 'azure-public.json');
    const chinaCloud = path.join(directory, 'azure-china.json');
    await fs.writeFile(publicCloud, JSON.stringify({ ranges: [{ cidr: '20.0.0.0/24', provider: 'azure-public', service: 'AzureCloud.eastus', network_type: 'hosting' }] }));
    await fs.writeFile(chinaCloud, JSON.stringify({ ranges: [{ cidr: '40.0.0.0/24', provider: 'azure-china', service: 'AzureCloud.chinanorth3', network_type: 'hosting' }] }));
    const provider = await CloudRangeProvider.load([publicCloud, chinaCloud]);
    assert.equal(provider.lookup('20.0.0.1').matches[0].provider, 'azure-public');
    assert.equal(provider.lookup('40.0.0.1').matches[0].provider, 'azure-china');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
