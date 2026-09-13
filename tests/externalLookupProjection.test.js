import test from 'node:test';
import assert from 'node:assert/strict';
import { projectExternalLookupBatch, projectExternalLookupItem } from '../src/services/ExternalLookupProjection.js';

test('external lookup preserves the complete explainable profile', () => {
  const result = projectExternalLookupItem({
    input: '1.1.1.1',
    status: 'resolved',
    ip: '1.1.1.1',
    asn: 13335,
    asn_org: 'Cloudflare, Inc.',
    asn_org_zh: 'Cloudflare',
    network_type: 'cdn',
    verified_crawler: false,
    asn_judgment: { value: 13335, support_count: 5, alternatives: [{ value: 64500 }] },
    asn_org_judgment: { value: 'Cloudflare, Inc.' },
    asn_judgment_zh: '高可信证据优先裁决',
    bgp_origin_asn: 13335,
    bgp_origin_asns: [13335],
    bgp_prefix: '1.1.1.0/24',
    bgp_conflict: false,
    rpki_status: 'valid',
    rir: 'APNIC',
    allocation_country: 'AU',
    rdap_urls: ['https://rdap.apnic.net/'],
    canonical_org: 'Cloudflare, Inc.',
    peeringdb_network_type: 'Content',
    source_claims: [{ source: 'dbip-asn', field: 'asn', value: 13335 }],
    evidence: [{ source: 'ripe-ris', field: 'asn', value: 13335, confidence: 'high' }],
    sources: ['dbip-asn', 'ripe-ris'],
  });

  assert.equal(result.asn, 13335);
  assert.equal(result.asn_org, 'Cloudflare, Inc.');
  assert.equal(result.network_type, 'cdn');
  assert.equal(result.verified_crawler, false);
  for (const field of [
    'asn_judgment', 'asn_org_judgment', 'asn_judgment_zh', 'bgp_origin_asn',
    'bgp_origin_asns', 'bgp_prefix', 'bgp_conflict', 'rpki_status', 'rir',
    'allocation_country', 'rdap_urls', 'canonical_org', 'peeringdb_network_type',
    'source_claims', 'evidence', 'sources',
  ]) assert.equal(field in result, true, `${field} must be preserved`);
});

test('external batch projection preserves aggregate metadata', () => {
  const result = projectExternalLookupBatch({
    data: [{ input: '8.8.8.8', status: 'resolved', asn: 15169, evidence: [{ field: 'asn' }] }],
    meta: { unique_count: 1, resolved_count: 1 },
  });
  assert.deepEqual(result.data, [{ input: '8.8.8.8', status: 'resolved', asn: 15169, evidence: [{ field: 'asn' }] }]);
  assert.deepEqual(result.meta, { unique_count: 1, resolved_count: 1 });
});
