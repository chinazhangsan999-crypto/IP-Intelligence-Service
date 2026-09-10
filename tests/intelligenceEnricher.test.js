import assert from 'node:assert/strict';
import test from 'node:test';
import { ClassificationRuleService } from '../src/services/ClassificationRuleService.js';
import { IntelligenceEnricher } from '../src/services/IntelligenceEnricher.js';

function source(id, result) {
  return { id, lookup() { return result; }, publicState() { return { id, ready: true, version: 'test' }; } };
}

test('cloud and Tor evidence enrich independent fields without inventing VPN status', () => {
  const enricher = new IntelligenceEnricher({
    cloudProvider: source('cloud-ranges', {
      available: true,
      matches: [{ provider: 'cloudflare', service: 'CLOUDFLARE', network_type: 'cdn' }],
    }),
    torProvider: source('tor-exit', { available: true, matched: true }),
    proxyProvider: source('ip2proxy-lite', { available: false, record: null }),
    ruleService: new ClassificationRuleService([]),
  });
  const result = enricher.lookup({ ip: '1.1.1.1', asn: 13335, asnOrg: 'Cloudflare' });

  assert.equal(result.networkType, 'cdn');
  assert.equal(result.flags.is_hosting, true);
  assert.equal(result.flags.is_tor, true);
  assert.equal(result.flags.is_proxy, true);
  assert.equal(result.flags.is_vpn, null);
  assert.ok(result.evidence.some((item) => item.field === 'cloud_provider'));
});

test('explicit classification rules override cloud classification and preserve both evidence entries', () => {
  const rules = new ClassificationRuleService([{
    name: 'manual-business',
    priority: 500,
    match_type: 'asn',
    match_value: '64500',
    network_type: 'business',
    confidence: 'high',
    flags: { is_hosting: false },
  }]);
  const enricher = new IntelligenceEnricher({
    cloudProvider: source('cloud-ranges', {
      available: true,
      matches: [{ provider: 'aws', service: 'AMAZON', network_type: 'hosting' }],
    }),
    torProvider: source('tor-exit', { available: true, matched: false }),
    proxyProvider: source('ip2proxy-lite', { available: false, record: null }),
    ruleService: rules,
  });
  const result = enricher.lookup({ ip: '203.0.113.1', asn: 64500, asnOrg: 'Example' });

  assert.equal(result.networkType, 'business');
  assert.equal(result.flags.is_hosting, false);
  assert.ok(result.evidence.some((item) => item.source === 'cloud-ranges'));
  assert.ok(result.evidence.some((item) => item.source === 'classification-rules'));
});

test('IP2Proxy types map to proxy, VPN and usage classifications using three-state output', () => {
  const enricher = new IntelligenceEnricher({
    cloudProvider: source('cloud-ranges', { available: true, matches: [] }),
    torProvider: source('tor-exit', { available: true, matched: false }),
    proxyProvider: source('ip2proxy-lite', {
      available: true,
      record: { isProxy: 1, proxyType: 'VPN', usageType: 'DCH', isp: 'Example Hosting' },
    }),
    ruleService: new ClassificationRuleService([]),
  });
  const result = enricher.lookup({ ip: '198.51.100.1', asn: 64501, asnOrg: 'Example' });

  assert.equal(result.networkType, 'hosting');
  assert.equal(result.flags.is_proxy, true);
  assert.equal(result.flags.is_vpn, true);
  assert.equal(result.flags.is_tor, false);
  assert.equal(result.flags.is_hosting, true);
  assert.equal(result.isp, 'Example Hosting');
});

test('official Tor evidence wins over weaker contradictory proxy data and records the conflict', () => {
  const enricher = new IntelligenceEnricher({
    cloudProvider: source('cloud-ranges', { available: true, matches: [] }),
    torProvider: source('tor-exit', { available: true, matched: false }),
    proxyProvider: source('ip2proxy-lite', {
      available: true,
      record: { isProxy: 1, proxyType: 'TOR', usageType: 'DCH', isp: 'Example Hosting' },
    }),
    ruleService: new ClassificationRuleService([]),
  });
  const result = enricher.lookup({ ip: '198.51.100.2', asn: 64502, asnOrg: 'Example' });

  assert.equal(result.flags.is_tor, false);
  assert.ok(result.conflicts.some((item) => item.field === 'is_tor'));
  assert.ok(result.sources.includes('judgment-engine'));
  assert.ok(result.evidence.some((item) => item.field === 'judgment_conflict'));
});
