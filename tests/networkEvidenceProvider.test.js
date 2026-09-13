import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { NetworkEvidenceProvider } from '../src/providers/NetworkEvidenceProvider.js';
import { IntelligenceEnricher } from '../src/services/IntelligenceEnricher.js';
import { IpLookupService } from '../src/services/IpLookupService.js';

async function fixtureDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'network-evidence-provider-'));
  const write = (name, value) => fs.writeFile(path.join(directory, name), typeof value === 'string' ? value : JSON.stringify(value));
  await Promise.all([
    write('iana-ipv4-special-registry.json', { records: [{ 'Address Block': '10.0.0.0/8', Name: 'Private-Use' }] }),
    write('iana-ipv6-special-registry.json', { records: [{ 'Address Block': '2001:db8::/32', Name: 'Documentation' }] }),
    write('fullbogons-ipv4.txt', '192.0.2.0/24\n'),
    write('fullbogons-ipv6.txt', '2001:db8::/32\n'),
    write('googlebot-ranges.json', { creationTime: 'test', prefixes: [{ ipv4Prefix: '1.1.1.0/24' }] }),
    write('google-special-crawlers.json', { prefixes: [{ ipv4Prefix: '2.2.2.0/24' }] }),
    write('google-user-triggered-fetchers.json', { prefixes: [{ ipv4Prefix: '3.3.3.0/24' }] }),
    write('bingbot-ranges.json', { prefixes: [{ ipv4Prefix: '4.4.4.0/24' }] }),
    write('apple-private-relay-ranges.json', { records: [{ cidr: '17.0.0.0/8', country_code: 'US', region_code: 'US-CA', city: 'Cupertino' }] }),
    write('rpki-vrps.json', { roas: [{ asn: 'AS13335', prefix: '1.1.1.0/24', maxLength: 24 }] }),
    write('nro-delegated-stats.txt', 'apnic|AU|ipv4|1.1.1.0|256|20110811|allocated\n'),
    write('rdap-ipv4.json', { services: [[['1.0.0.0/8'], ['https://rdap.apnic.net/']]] }),
    write('rdap-ipv6.json', { services: [[['2001:db8::/32'], ['https://rdap.example/']]] }),
    write('rdap-asn.json', { services: [[['13335-13335'], ['https://rdap.arin.net/registry/', 'http://unsafe.example/']]] }),
    write('peeringdb-networks.json', { networks: [{ asn: 13335, name: 'Example Content', info_type: 'Content' }] }),
    fs.writeFile(path.join(directory, 'riswhoisdump.IPv4.gz'), gzipSync('13335 1.1.1.0/24 42\n')),
    fs.writeFile(path.join(directory, 'caida-as2org.jsonl.gz'), gzipSync([
      JSON.stringify({ organizationId: 'ORG-CF', name: 'Example Network', country: 'US', type: 'Organization' }),
      JSON.stringify({ asn: '13335', organizationId: 'ORG-CF', type: 'ASN' }),
    ].join('\n'))),
  ]);
  return directory;
}

test('network evidence provider resolves routing, registration, identity and organization evidence', async () => {
  const directory = await fixtureDirectory();
  try {
    const provider = await NetworkEvidenceProvider.load(directory);
    const result = provider.lookup('1.1.1.1', 13335);
    assert.equal(result.details.bgp_origin_asn, 13335);
    assert.equal(result.details.bgp_prefix, '1.1.1.0/24');
    assert.equal(result.details.bgp_conflict, false);
    assert.equal(result.details.rpki_status, 'valid');
    assert.equal(result.details.rir, 'APNIC');
    assert.equal(result.details.allocation_country, 'AU');
    assert.equal(result.details.verified_crawler, true);
    assert.equal(result.details.crawler_operator, 'Google');
    assert.equal(result.details.canonical_org, 'Example Network');
    assert.equal(result.details.peeringdb_network_type, 'Content');
    assert.deepEqual(result.details.rdap_urls, ['https://rdap.apnic.net/']);
    assert.deepEqual(result.details.asn_rdap_urls, ['https://rdap.arin.net/registry/']);
    assert.ok(result.assertions.some((item) => item.field === 'network_type' && item.value === 'cdn'));
    assert.equal(provider.publicState().ready, true);

    const conflict = provider.lookup('1.1.1.1', 64500);
    assert.equal(conflict.details.bgp_conflict, true);
    assert.equal(conflict.details.rpki_status, 'valid');
    assert.ok(conflict.evidence.some((item) => item.field === 'asn_conflict'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('network identity flags remain independent and non-matches remain explicit only for complete sources', async () => {
  const directory = await fixtureDirectory();
  try {
    const provider = await NetworkEvidenceProvider.load(directory);
    assert.equal(provider.lookup('17.0.0.1').details.is_private_relay, true);
    assert.equal(provider.lookup('192.0.2.1').details.is_fullbogon, true);
    assert.equal(provider.lookup('8.8.8.8').details.verified_crawler, false);
    assert.equal(provider.lookup('8.8.8.8').details.is_private_relay, false);
    assert.equal(provider.lookup('10.0.0.1').details.special_purpose, 'Private-Use');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('formal lookup exposes supplemental evidence without turning it into an enforcement verdict', async () => {
  const directory = await fixtureDirectory();
  try {
    const networkEvidenceProvider = await NetworkEvidenceProvider.load(directory);
    const cityProvider = {
      id: 'city',
      lookup: () => ({ available: true, record: { country: { iso_code: 'AU', names: { en: 'Australia' } } } }),
      publicState: () => ({ id: 'city', ready: true, version: 'test' }),
    };
    const asnProvider = {
      id: 'asn',
      lookup: () => ({ available: true, record: { autonomous_system_number: 13335, autonomous_system_organization: 'Example' } }),
      publicState: () => ({ id: 'asn', ready: true, version: 'test' }),
    };
    const service = new IpLookupService({
      cityProvider,
      asnProvider,
      enricher: new IntelligenceEnricher({ networkEvidenceProvider }),
    });
    const result = service.lookupBatch(['1.1.1.1']).data[0];
    assert.equal(result.rpki_status, 'valid');
    assert.equal(result.verified_crawler, true);
    assert.equal(result.network_type, 'cdn');
    assert.equal(result.is_proxy, null);
    assert.equal(result.is_vpn, null);
    assert.ok(result.evidence.some((item) => item.field === 'resource_registration'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('non-public lookup receives IANA purpose evidence without querying MMDB providers', async () => {
  const directory = await fixtureDirectory();
  try {
    const networkEvidenceProvider = await NetworkEvidenceProvider.load(directory);
    let mmdbQueries = 0;
    const unavailableProvider = {
      id: 'unused',
      lookup: () => { mmdbQueries += 1; return { available: true, record: null }; },
      publicState: () => ({ id: 'unused', ready: true, version: 'test' }),
    };
    const service = new IpLookupService({
      cityProvider: unavailableProvider,
      asnProvider: unavailableProvider,
      enricher: new IntelligenceEnricher({ networkEvidenceProvider }),
    });
    const result = service.lookupBatch(['10.0.0.1']).data[0];
    assert.equal(result.scope, 'private');
    assert.equal(result.special_purpose, 'Private-Use');
    assert.equal(result.bgp_origin_asn, null);
    assert.equal(result.rpki_status, null);
    assert.equal(mmdbQueries, 0);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
