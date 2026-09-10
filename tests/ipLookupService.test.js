import assert from 'node:assert/strict';
import test from 'node:test';
import { IpLookupService } from '../src/services/IpLookupService.js';

function provider(id, records = {}, ready = true, version = '2026-09') {
  let calls = 0;
  return {
    id,
    lookup(ip) {
      calls += 1;
      return { available: ready, record: records[ip] || null };
    },
    publicState() { return { id, ready, version }; },
    getCalls() { return calls; },
  };
}

test('merges City and ASN evidence while preserving unknown tri-state flags', () => {
  const city = provider('dbip-city', {
    '1.1.1.1': {
      country: { iso_code: 'AU', names: { en: 'Australia', 'zh-CN': '澳大利亚' } },
      subdivisions: [{ names: { en: 'Queensland' } }],
      city: { names: { en: 'South Brisbane' } },
    },
  });
  const asn = provider('dbip-asn', {
    '1.1.1.1': {
      autonomous_system_number: 13335,
      autonomous_system_organization: 'Cloudflare, Inc.',
    },
  });
  const service = new IpLookupService({
    cityProvider: city,
    asnProvider: asn,
    now: () => new Date('2026-09-11T00:00:00.000Z'),
  });

  const result = service.lookupBatch(['1.1.1.1']);
  assert.equal(result.data[0].country_name, '澳大利亚');
  assert.equal(result.data[0].region, 'Queensland');
  assert.equal(result.data[0].asn, 13335);
  assert.equal(result.data[0].network_type, 'unknown');
  assert.equal(result.data[0].is_hosting, null);
  assert.equal(result.data[0].confidence, 'medium');
  assert.deepEqual(result.data[0].sources, ['dbip-city', 'dbip-asn']);
  assert.equal(result.meta.resolved_count, 1);
  assert.deepEqual(result.meta.database_versions, {
    'dbip-city': '2026-09',
    'dbip-asn': '2026-09',
  });
});

test('does not query MMDB for private addresses and deduplicates normalized inputs', () => {
  const city = provider('dbip-city');
  const asn = provider('dbip-asn');
  const service = new IpLookupService({ cityProvider: city, asnProvider: asn });

  const result = service.lookupBatch([
    '10.0.0.1',
    '2409:8000:0:0:abcd::1/64',
    '2409:8000::2/64',
  ]);
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].scope, 'private');
  assert.equal(result.data[1].ip, '2409:8000::/64');
  assert.equal(result.meta.requested_count, 3);
  assert.equal(result.meta.unique_count, 2);
  assert.equal(city.getCalls(), 1);
  assert.equal(asn.getCalls(), 1);
});

test('returns per-item invalid and unavailable results without failing the batch', () => {
  const service = new IpLookupService({
    cityProvider: provider('dbip-city', {}, false, null),
    asnProvider: provider('dbip-asn', {}, false, null),
  });
  const result = service.lookupBatch(['not-an-ip', '8.8.8.8']);

  assert.equal(result.data[0].status, 'invalid');
  assert.equal(result.data[1].status, 'unavailable');
  assert.equal(result.meta.invalid_count, 1);
  assert.equal(result.meta.unavailable_count, 1);
  assert.equal(result.meta.unique_count, 2);
});
