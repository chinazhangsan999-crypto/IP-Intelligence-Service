import { parseIpInput } from '../ip/ipAddress.js';

function localizedName(value) {
  const names = value?.names;
  return names?.['zh-CN'] || names?.en || null;
}

function firstSubdivision(record) {
  return Array.isArray(record?.subdivisions) ? record.subdivisions[0] : null;
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
  constructor({ cityProvider, asnProvider, enricher = null, now = () => new Date() }) {
    this.cityProvider = cityProvider;
    this.asnProvider = asnProvider;
    this.enricher = enricher;
    this.now = now;
  }

  databaseVersions() {
    const providers = [
      this.cityProvider,
      this.asnProvider,
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

    const city = this.cityProvider.lookup(parsed.queryAddress);
    const asn = this.asnProvider.lookup(parsed.queryAddress);
    if (!city.available && !asn.available) {
      result.status = 'unavailable';
      result.message = 'IP data sources are unavailable';
      return result;
    }

    if (city.available) {
      result.sources.push(this.cityProvider.id);
      if (city.record) {
        result.country_code = city.record.country?.iso_code || null;
        result.country_name = localizedName(city.record.country);
        result.region = localizedName(firstSubdivision(city.record));
        result.city = localizedName(city.record.city);
        result.evidence.push(
          ...evidence(this.cityProvider.id, 'country_code', result.country_code, 'medium'),
          ...evidence(this.cityProvider.id, 'region', result.region, 'medium'),
          ...evidence(this.cityProvider.id, 'city', result.city, 'medium'),
        );
      }
    }

    if (asn.available) {
      result.sources.push(this.asnProvider.id);
      if (asn.record) {
        const number = Number(asn.record.autonomous_system_number);
        result.asn = Number.isSafeInteger(number) && number >= 0 ? number : null;
        result.asn_org = asn.record.autonomous_system_organization || null;
        result.evidence.push(
          ...evidence(this.asnProvider.id, 'asn', result.asn, 'high'),
          ...evidence(this.asnProvider.id, 'asn_org', result.asn_org, 'high'),
        );
      }
    }

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

    const matchedSources = [city.record, asn.record].filter(Boolean).length;
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
