import { parseIpInput } from '../ip/ipAddress.js';

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

function evidence(source, field, value, confidence) {
  return value === null || value === undefined || value === ''
    ? []
    : [{ source, field, value: String(value), confidence }];
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
    confidence: 'unknown',
    evidence: [],
    source_claims: [],
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
    confidence: 'unknown',
    evidence: [],
    sources: [],
  };
}

export class IpLookupService {
  constructor({ cityProvider, asnProvider, countryProviders = [], cityFallbackProviders = [], asnFallbackProviders = [], asnProviders = null, enricher = null, now = () => new Date() }) {
    this.cityProviders = [cityProvider, ...cityFallbackProviders].filter(Boolean);
    this.countryProviders = countryProviders.filter(Boolean);
    this.asnProviders = (asnProviders || [asnProvider, ...asnFallbackProviders]).filter(Boolean);
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
      return versions;
    }, {});
  }

  lookupOne(parsed) {
    if (!parsed.valid) return invalidResult(parsed);
    const result = baseResult(parsed);
    if (parsed.scope !== 'public') return result;

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
        result.evidence.push(...evidence(item.provider.id, field, value, item.provider.id.startsWith('sapics-') ? 'medium' : 'high'));
      }
    }
    const countryRecords = [...countries, ...cities];
    result.country_code = firstValue(countryRecords, 'country_code');
    result.country_name = firstValue(countryRecords, 'country_name');
    const selectedCity = cities.find((item) => item.record) || null;
    result.state1 = selectedCity?.fields.state1 || null;
    result.state2 = selectedCity?.fields.state2 || null;
    result.region = result.state1;
    result.city = selectedCity?.fields.city || null;
    result.postcode = selectedCity?.fields.postcode || null;
    result.latitude = selectedCity?.fields.latitude || null;
    result.longitude = selectedCity?.fields.longitude || null;
    result.timezone = selectedCity?.fields.timezone || null;
    result.asn = firstValue(asns, 'asn');
    result.asn_org = firstValue(asns, 'asn_org');

    let enrichment = null;
    if (this.enricher) {
      enrichment = this.enricher.lookup({
        ip: parsed.queryAddress,
        asn: result.asn,
        asnOrg: result.asn_org,
      });
      result.network_type = enrichment.networkType;
      result.is_mobile = enrichment.flags.is_mobile;
      result.is_hosting = enrichment.flags.is_hosting;
      result.is_proxy = enrichment.flags.is_proxy;
      result.is_vpn = enrichment.flags.is_vpn;
      result.is_tor = enrichment.flags.is_tor;
      result.is_anycast = enrichment.flags.is_anycast;
      result.isp = enrichment.isp;
      result.evidence.push(...enrichment.evidence);
      result.sources.push(...enrichment.sources);
      result.sources = [...new Set(result.sources)];
    }

    result.sources = [...new Set(result.sources)];
    const matchedSources = claims.length;
    const locationConfidence = matchedSources === 2 ? 'medium' : matchedSources === 1 ? 'low' : 'unknown';
    const levels = ['unknown', 'low', 'medium', 'high'];
    result.confidence = levels[Math.max(
      levels.indexOf(locationConfidence),
      levels.indexOf(enrichment?.confidence || 'unknown'),
    )];
    return result;
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
