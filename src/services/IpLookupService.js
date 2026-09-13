import { parseIpInput } from '../ip/ipAddress.js';
import { adjudicateEvidence } from './EvidenceAdjudicator.js';
import { localizeResult } from './ChineseLocalizationService.js';

function localizedName(value) {
  const names = value?.names;
  return names?.['zh-CN'] || names?.en || null;
}

function firstSubdivision(record) {
  return Array.isArray(record?.subdivisions) ? record.subdivisions[0] : null;
}

function secondSubdivision(record) {
  return Array.isArray(record?.subdivisions) ? record.subdivisions[1] : null;
}

function countryCode(record) {
  const value = record?.country?.iso_code || record?.country_code || record?.countryCode || record?.country;
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null;
}

function cityFields(record) {
  const location = record?.location || {};
  return {
    country_code: countryCode(record),
    country_name: localizedName(record?.country),
    state1: localizedName(firstSubdivision(record)),
    state2: localizedName(secondSubdivision(record)),
    city: localizedName(record?.city),
    postcode: record?.postal?.code || record?.postcode || null,
    latitude: Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : null,
    longitude: Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : null,
    timezone: location.time_zone || location.timezone || record?.timezone || null,
  };
}

function asnFields(record) {
  const number = Number(record?.autonomous_system_number ?? record?.asn ?? record?.autonomousSystemNumber);
  return {
    asn: Number.isSafeInteger(number) && number >= 0 ? number : null,
    asn_org: record?.autonomous_system_organization || record?.asn_org || record?.autonomousSystemOrganization || null,
  };
}

function firstValue(records, field) {
  for (const item of records) {
    const value = item.fields[field];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function countryNameFor(code) {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code) || null;
  } catch {
    return null;
  }
}

function evidence(source, field, value, confidence) {
  return value === null || value === undefined || value === ''
    ? []
    : [{ source, field, value: String(value), confidence }];
}

function sourceConfidence(source) {
  return source === 'ripe-ris' || source.startsWith('classification-rules') ? 'high' : 'medium';
}

function uniqueProviders(providers) {
  const seen = new Set();
  return providers.filter((provider) => {
    if (!provider || seen.has(provider.id)) return false;
    seen.add(provider.id);
    return true;
  });
}

function assertionsFor(records, field) {
  return records
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.available && item.record)
    .map(({ item, index }) => ({
      field,
      value: item.fields[field],
      source: item.provider.id,
      confidence: sourceConfidence(item.provider.id),
      priority: records.length - index,
    }))
    .filter((item) => item.value !== null && item.value !== undefined && item.value !== '');
}

function baseResult(parsed) {
  return {
    input: parsed.input,
    status: 'resolved',
    message: null,
    ip: parsed.ip,
    ip_version: parsed.ipVersion,
    scope: parsed.scope,
    country_code: null,
    country_name: null,
    region: null,
    city: null,
    state1: null,
    state2: null,
    postcode: null,
    latitude: null,
    longitude: null,
    timezone: null,
    asn: null,
    asn_org: null,
    isp: null,
    network_type: 'unknown',
    is_mobile: null,
    is_hosting: null,
    is_proxy: null,
    is_vpn: null,
    is_tor: null,
    is_anycast: null,
    bgp_origin_asn: null,
    bgp_origin_asns: [],
    bgp_prefix: null,
    bgp_conflict: null,
    rpki_status: null,
    rir: null,
    allocation_country: null,
    allocation_status: null,
    allocation_date: null,
    rdap_urls: [],
    asn_rdap_urls: [],
    special_purpose: null,
    is_fullbogon: null,
    verified_crawler: null,
    crawler_operator: null,
    crawler_type: null,
    is_private_relay: null,
    private_relay_region: null,
    canonical_org: null,
    canonical_org_country: null,
    peeringdb_network_type: null,
    confidence: 'unknown',
    evidence: [],
    source_claims: [],
    country_judgment: null,
    asn_judgment: null,
    asn_org_judgment: null,
    network_judgment: null,
    sources: [],
  };
}

function invalidResult(parsed) {
  return {
    input: parsed.input,
    status: 'invalid',
    message: parsed.message,
    ip: null,
    ip_version: null,
    scope: 'unknown',
    country_code: null,
    country_name: null,
    region: null,
    city: null,
    asn: null,
    asn_org: null,
    isp: null,
    network_type: 'unknown',
    is_mobile: null,
    is_hosting: null,
    is_proxy: null,
    is_vpn: null,
    is_tor: null,
    is_anycast: null,
    bgp_origin_asn: null,
    bgp_origin_asns: [],
    bgp_prefix: null,
    bgp_conflict: null,
    rpki_status: null,
    rir: null,
    allocation_country: null,
    allocation_status: null,
    allocation_date: null,
    rdap_urls: [],
    asn_rdap_urls: [],
    special_purpose: null,
    is_fullbogon: null,
    verified_crawler: null,
    crawler_operator: null,
    crawler_type: null,
    is_private_relay: null,
    private_relay_region: null,
    canonical_org: null,
    canonical_org_country: null,
    peeringdb_network_type: null,
    confidence: 'unknown',
    evidence: [],
    sources: [],
  };
}

export class IpLookupService {
  constructor({ cityProvider, asnProvider, countryProviders = [], cityFallbackProviders = [], asnFallbackProviders = [], asnProviders = null, enricher = null, now = () => new Date() }) {
    this.cityProviders = uniqueProviders([cityProvider, ...cityFallbackProviders]);
    this.countryProviders = uniqueProviders(countryProviders);
    this.asnProviders = uniqueProviders(asnProviders || [asnProvider, ...asnFallbackProviders]);
    this.enricher = enricher;
    this.now = now;
  }

  databaseVersions() {
    const providers = [
      ...this.countryProviders,
      ...this.cityProviders,
      ...this.asnProviders,
      ...(this.enricher?.providers() || []),
    ];
    return providers.reduce((versions, provider) => {
      const state = provider.publicState();
      if (state.ready && state.version) versions[state.id] = state.version;
      Object.assign(versions, provider.sourceVersions?.() || {});
      return versions;
    }, {});
  }

  lookupOne(parsed) {
    if (!parsed.valid) return invalidResult(parsed);
    const result = baseResult(parsed);
    if (parsed.scope !== 'public') {
      const supplemental = this.enricher?.lookupSupplementalEvidence?.({ ip: parsed.queryAddress, asn: null });
      if (supplemental) {
        Object.assign(result, supplemental.details || {});
        result.evidence.push(...(supplemental.evidence || []));
        result.sources.push(...(supplemental.sources || []));
      }
      return localizeResult(result);
    }

    const query = (provider, fields) => {
      const response = provider.lookup(parsed.queryAddress);
      if (!response.available) return { provider, available: false, record: null, fields: {} };
      return { provider, available: true, record: response.record, fields: response.record ? fields(response.record) : {} };
    };
    const countries = this.countryProviders.map((provider) => query(provider, (record) => ({
      country_code: countryCode(record), country_name: localizedName(record?.country),
    })));
    const cities = this.cityProviders.map((provider) => query(provider, cityFields));
    const asns = this.asnProviders.map((provider) => query(provider, asnFields));
    if (![...countries, ...cities, ...asns].some((item) => item.available)) {
      result.status = 'unavailable';
      result.message = 'IP data sources are unavailable';
      return result;
    }

    const claims = [...countries, ...cities, ...asns].filter((item) => item.available && item.record);
    for (const item of [...countries, ...cities, ...asns].filter((item) => item.available)) result.sources.push(item.provider.id);
    for (const item of claims) {
      for (const [field, value] of Object.entries(item.fields)) {
        if (value === null || value === undefined || value === '') continue;
        result.source_claims.push({ source: item.provider.id, field, value });
        result.evidence.push(...evidence(item.provider.id, field, value, sourceConfidence(item.provider.id)));
      }
    }
    const countryRecords = [...countries, ...cities];
    result.country_judgment = adjudicateEvidence('country_code', assertionsFor(countryRecords, 'country_code'), null);
    result.country_code = result.country_judgment.value;
    result.country_name = countryNameFor(result.country_code)
      || countryRecords.find((item) => item.fields.country_code === result.country_code)?.fields.country_name
      || null;
    const selectedCity = cities.find((item) => item.record) || null;
    const cityMatchesCountry = !selectedCity?.fields.country_code
      || !result.country_code
      || selectedCity.fields.country_code === result.country_code;
    if (!cityMatchesCountry) {
      result.evidence.push(...evidence(selectedCity.provider.id, 'location_conflict', `${selectedCity.fields.country_code} != ${result.country_code}`, 'low'));
    }
    result.state1 = cityMatchesCountry ? selectedCity?.fields.state1 || null : null;
    result.state2 = cityMatchesCountry ? selectedCity?.fields.state2 || null : null;
    result.region = result.state1;
    result.city = cityMatchesCountry ? selectedCity?.fields.city || null : null;
    result.postcode = cityMatchesCountry ? selectedCity?.fields.postcode || null : null;
    result.latitude = cityMatchesCountry ? selectedCity?.fields.latitude || null : null;
    result.longitude = cityMatchesCountry ? selectedCity?.fields.longitude || null : null;
    result.timezone = cityMatchesCountry ? selectedCity?.fields.timezone || null : null;
    const preliminaryAsn = adjudicateEvidence('asn', assertionsFor(asns, 'asn'), null);
    result.asn = preliminaryAsn.value;
    result.asn_org = asns.find((item) => item.fields.asn === result.asn)?.fields.asn_org || firstValue(asns, 'asn_org');

    let enrichment = null;
    if (this.enricher) {
      enrichment = this.enricher.lookup({
        ip: parsed.queryAddress,
        asn: result.asn,
        asnOrg: result.asn_org,
      });
      const asnAssertions = assertionsFor(asns, 'asn');
      if (Number.isSafeInteger(enrichment.details?.bgp_origin_asn)) {
        asnAssertions.push({
          field: 'asn', value: enrichment.details.bgp_origin_asn, source: 'ripe-ris',
          confidence: 'high', priority: enrichment.details.rpki_status === 'valid' ? 1050 : 1000,
        });
      }
      result.asn_judgment = adjudicateEvidence('asn', asnAssertions, null);
      const finalAsn = result.asn_judgment.value;
      if (finalAsn !== result.asn) {
        result.asn = finalAsn;
        result.asn_org = asns.find((item) => item.fields.asn === finalAsn)?.fields.asn_org || result.asn_org;
        enrichment = this.enricher.lookup({ ip: parsed.queryAddress, asn: finalAsn, asnOrg: result.asn_org });
      }
      result.network_type = enrichment.networkType;
      result.is_mobile = enrichment.flags.is_mobile;
      result.is_hosting = enrichment.flags.is_hosting;
      result.is_proxy = enrichment.flags.is_proxy;
      result.is_vpn = enrichment.flags.is_vpn;
      result.is_tor = enrichment.flags.is_tor;
      result.is_anycast = enrichment.flags.is_anycast;
      result.isp = enrichment.isp;
      Object.assign(result, enrichment.details || {});
      result.evidence.push(...enrichment.evidence);
      result.sources.push(...enrichment.sources);
      result.sources = [...new Set(result.sources)];
      result.network_judgment = enrichment.decisions?.find((item) => item.field === 'network_type') || null;
    }

    if (!result.asn_judgment) result.asn_judgment = preliminaryAsn;
    const orgAssertions = asns
      .filter((item) => item.fields.asn === result.asn && item.fields.asn_org)
      .map((item) => ({ field: 'asn_org', value: item.fields.asn_org, source: item.provider.id, confidence: sourceConfidence(item.provider.id) }));
    if (result.canonical_org) orgAssertions.push({ field: 'asn_org', value: result.canonical_org, source: 'caida-as2org', confidence: 'high', priority: 900 });
    result.asn_org_judgment = adjudicateEvidence('asn_org', orgAssertions, result.asn_org);
    result.asn_org = result.asn_org_judgment.value;

    result.sources = [...new Set(result.sources)];
    const levels = ['unknown', 'low', 'medium', 'high'];
    result.confidence = levels[Math.max(
      levels.indexOf(result.country_judgment?.confidence || 'unknown'),
      levels.indexOf(result.asn_judgment?.confidence || 'unknown'),
      levels.indexOf(enrichment?.confidence || 'unknown'),
    )];
    return localizeResult(result);
  }

  lookupBatch(inputs) {
    const requestedCount = inputs.length;
    const unique = [];
    const seen = new Set();

    for (const input of inputs) {
      const parsed = parseIpInput(input);
      const key = parsed.valid
        ? `valid:${parsed.ip}`
        : `invalid:${typeof input}:${String(input)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(parsed);
    }

    const data = unique.map((item) => this.lookupOne(item));
    const count = (status) => data.filter((item) => item.status === status).length;
    return {
      data,
      meta: {
        requested_count: requestedCount,
        unique_count: data.length,
        resolved_count: count('resolved'),
        invalid_count: count('invalid'),
        unavailable_count: count('unavailable'),
        generated_at: this.now().toISOString(),
        database_versions: this.databaseVersions(),
      },
    };
  }
}
