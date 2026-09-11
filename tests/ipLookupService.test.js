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

test('keeps every available source claim while choosing configured country and ASN priorities', () => {
  const userCountry = provider('sapics-user-country', { '8.8.8.8': { country_code: 'US' } });
  const city = provider('dbip-city', { '8.8.8.8': {
    country: { iso_code: 'US', names: { en: 'United States' } },
    subdivisions: [{ names: { en: 'California' } }, { names: { en: 'Santa Clara' } }],
    city: { names: { en: 'Mountain View' } }, postal: { code: '94043' },
    location: { latitude: 37.4056, longitude: -122.0775, time_zone: 'America/Los_Angeles' },
  } });
  const originAsn = provider('sapics-origin-asn', { '8.8.8.8': { autonomous_system_number: 15169, autonomous_system_organization: 'Google LLC' } });
  const fallbackAsn = provider('dbip-asn', { '8.8.8.8': { autonomous_system_number: 64512, autonomous_system_organization: 'Fallback' } });
  const service = new IpLookupService({
    cityProvider: city,
    asnProvider: fallbackAsn,
    countryProviders: [userCountry],
    asnProviders: [originAsn, fallbackAsn],
  });

  const [result] = service.lookupBatch(['8.8.8.8']).data;
  assert.equal(result.country_code, 'US');
  assert.equal(result.state1, 'California');
  assert.equal(result.state2, 'Santa Clara');
  assert.equal(result.postcode, '94043');
  assert.equal(result.latitude, 37.4056);
  assert.equal(result.timezone, 'America/Los_Angeles');
  assert.equal(result.asn, 15169);
  assert.ok(result.source_claims.some((claim) => claim.source === 'sapics-user-country' && claim.field === 'country_code'));
  assert.ok(result.source_claims.some((claim) => claim.source === 'dbip-asn' && claim.field === 'asn'));
});

test('does not combine city fields from different providers into one location', () => {
  const primaryCity = provider('dbip-city', { '8.8.8.8': {
    country: { iso_code: 'US' }, city: { names: { en: 'Mountain View' } },
    location: { latitude: 37.4, longitude: -122.0 },
  } });
  const fallbackCity = provider('sapics-geolite2-city-ipv4', { '8.8.8.8': {
    country: { iso_code: 'US' }, city: { names: { en: 'Elsewhere' } },
    location: { latitude: 1, longitude: 2, time_zone: 'Elsewhere/Time' },
  } });
  const service = new IpLookupService({ cityProvider: primaryCity, asnProvider: provider('dbip-asn'), cityFallbackProviders: [fallbackCity] });
  const [result] = service.lookupBatch(['8.8.8.8']).data;
  assert.equal(result.city, 'Mountain View');
  assert.equal(result.timezone, null);
  assert.ok(result.source_claims.some((claim) => claim.value === 'Elsewhere/Time'));
});
