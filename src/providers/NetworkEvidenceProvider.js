import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createGunzip, gunzipSync } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { CompactPrefixMatcher } from '../ip/CompactPrefixMatcher.js';

const SOURCE_FILES = Object.freeze({
  ripeRis4: 'riswhoisdump.IPv4.gz',
  ripeRis6: 'riswhoisdump.IPv6.gz',
  rpki: 'rpki-vrps.json',
  rir: 'nro-delegated-stats.txt',
  rdap4: 'rdap-ipv4.json',
  rdap6: 'rdap-ipv6.json',
  iana4: 'iana-ipv4-special-registry.json',
  iana6: 'iana-ipv6-special-registry.json',
  fullbogons4: 'fullbogons-ipv4.txt',
  fullbogons6: 'fullbogons-ipv6.txt',
  googlebot: 'googlebot-ranges.json',
  googleSpecial: 'google-special-crawlers.json',
  googleUserTriggered: 'google-user-triggered-fetchers.json',
  bingbot: 'bingbot-ranges.json',
  appleRelay: 'apple-private-relay-ranges.json',
  caida: 'caida-as2org.jsonl.gz',
  peeringDb: 'peeringdb-networks.json',
});

function emptyLayer(id, message = 'Data file is missing') {
  return { id, available: false, message, updatedAt: null, records: 0 };
}

function readyLayer(id, data, stats, records) {
  return {
    id,
    available: true,
    message: null,
    updatedAt: stats?.mtime?.toISOString?.() || null,
    records,
    ...data,
  };
}

async function optionalFile(filePath, loader, id) {
  try {
    const stats = await fsp.stat(filePath);
    return await loader(filePath, stats);
  } catch (error) {
    return emptyLayer(id, error.code === 'ENOENT' ? 'Data file is missing' : 'Data file could not be loaded');
  }
}

function cidrLength(cidr) {
  const value = Number(String(cidr).split('/')[1]);
  return Number.isInteger(value) ? value : -1;
}

function normalizedAsn(value) {
  const number = Number(String(value ?? '').replace(/^AS/i, ''));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function prefixRows(payload) {
  return (Array.isArray(payload?.prefixes) ? payload.prefixes : [])
    .map((entry) => entry?.ipv4Prefix || entry?.ipv6Prefix)
    .filter((cidr) => typeof cidr === 'string');
}

async function loadJsonPrefixLayer(filePath, id, entries) {
  return optionalFile(filePath, async (target, stats) => {
    const payload = JSON.parse(await fsp.readFile(target, 'utf8'));
    const matcher = new CompactPrefixMatcher();
    let records = 0;
    for (const entry of entries(payload)) {
      if (!entry?.cidr) continue;
      try {
        matcher.add(entry.cidr, entry.value);
        records += 1;
      } catch {
        // Upstream records are individually ignored when a CIDR is malformed.
      }
    }
    if (records === 0) throw new Error(`${id} is empty`);
    return readyLayer(id, { matcher: matcher.finalize() }, stats, records);
  }, id);
}

async function loadTextPrefixLayer(filePaths, id) {
  const matcher = new CompactPrefixMatcher();
  let records = 0;
  let availableFiles = 0;
  let newest = null;
  for (const filePath of filePaths) {
    try {
      const stats = await fsp.stat(filePath);
      newest = !newest || stats.mtime > newest ? stats.mtime : newest;
      availableFiles += 1;
      const input = fs.createReadStream(filePath, { encoding: 'utf8' });
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      for await (const rawLine of lines) {
        const cidr = rawLine.trim();
        if (!cidr || cidr.startsWith('#')) continue;
        try {
          matcher.add(cidr, true);
          records += 1;
        } catch {
          // Ignore malformed upstream rows without invalidating the last good snapshot.
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') return emptyLayer(id, 'Data file could not be loaded');
    }
  }
  if (availableFiles === 0 || records === 0) return emptyLayer(id);
  return readyLayer(id, { matcher: matcher.finalize(), complete: availableFiles === filePaths.length }, { mtime: newest }, records);
}

async function loadRipeRisLayer(filePaths) {
  const id = 'ripe-ris';
  const matcher = new CompactPrefixMatcher();
  let records = 0;
  let availableFiles = 0;
  let newest = null;
  for (const filePath of filePaths) {
    try {
      const stats = await fsp.stat(filePath);
      newest = !newest || stats.mtime > newest ? stats.mtime : newest;
      availableFiles += 1;
      const input = fs.createReadStream(filePath).pipe(createGunzip());
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      for await (const line of lines) {
        const match = line.match(/^(\d+|\{\d+(?:,\d+)*\})\s+(\S+\/\d+)\s+(\d+)/);
        if (!match) continue;
        const asns = match[1].replace(/[{}]/g, '').split(',').map(normalizedAsn).filter(Number.isSafeInteger);
        if (asns.length === 0) continue;
        try {
          matcher.add(match[2], { prefix: match[2], asns, peers: Number(match[3]) || 0 });
          records += 1;
        } catch {
          // Ignore malformed route rows.
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') return emptyLayer(id, 'RIPE RIS snapshot could not be loaded');
    }
  }
  if (availableFiles === 0 || records === 0) return emptyLayer(id);
  return readyLayer(id, { matcher: matcher.finalize(), complete: availableFiles === filePaths.length }, { mtime: newest }, records);
}
async function loadRpkiLayer(filePath) {
  const id = 'rpki-vrps';
  return optionalFile(filePath, async (target, stats) => {
    const payload = JSON.parse(await fsp.readFile(target, 'utf8'));
    const matcher = new CompactPrefixMatcher();
    let records = 0;
    for (const roa of payload?.roas || []) {
      const asn = normalizedAsn(roa?.asn);
      if (!roa?.prefix || asn === null) continue;
      try {
        matcher.add(roa.prefix, {
          prefix: roa.prefix,
          asn,
          maxLength: Number.isInteger(Number(roa.maxLength)) ? Number(roa.maxLength) : cidrLength(roa.prefix),
        });
        records += 1;
      } catch {
        // Ignore malformed VRPs.
      }
    }
    if (records === 0) throw new Error('RPKI snapshot is empty');
    return readyLayer(id, { matcher: matcher.finalize() }, stats, records);
  }, id);
}

function ipv4Number(value) {
  const bytes = ipaddr.parse(value).toByteArray();
  return (((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3]) >>> 0;
}

function findIpv4Range(ranges, ip) {
  let low = 0;
  let high = ranges.length - 1;
  let candidate = null;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle].start <= ip) {
      candidate = ranges[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return candidate && ip <= candidate.end ? candidate : null;
}

async function loadRirLayer(filePath) {
  const id = 'nro-rir-delegated';
  return optionalFile(filePath, async (target, stats) => {
    const ipv4 = [];
    const ipv6 = new CompactPrefixMatcher();
    let records = 0;
    const input = fs.createReadStream(target, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      const [registry, country, type, start, value, date, status] = line.split('|');
      if (!['ipv4', 'ipv6'].includes(type) || !start || !value) continue;
      const record = { registry: registry?.toUpperCase() || null, country: country || null, date: date || null, status: status || null };
      try {
        if (type === 'ipv4') {
          const first = ipv4Number(start);
          const count = Number(value);
          if (!Number.isSafeInteger(count) || count < 1) continue;
          ipv4.push({ start: first, end: first + count - 1, ...record });
        } else {
          ipv6.add(`${start}/${Number(value)}`, record);
        }
        records += 1;
      } catch {
        // Ignore malformed delegated rows.
      }
    }
    if (records === 0) throw new Error('RIR snapshot is empty');
    ipv4.sort((left, right) => left.start - right.start);
    return readyLayer(id, { ipv4, ipv6: ipv6.finalize() }, stats, records);
  }, id);
}

async function loadRdapLayer(filePaths) {
  const id = 'iana-rdap-bootstrap';
  const matcher = new CompactPrefixMatcher();
  let records = 0;
  let availableFiles = 0;
  let newest = null;
  for (const filePath of filePaths) {
    try {
      const stats = await fsp.stat(filePath);
      newest = !newest || stats.mtime > newest ? stats.mtime : newest;
      const payload = JSON.parse(await fsp.readFile(filePath, 'utf8'));
      availableFiles += 1;
      for (const service of payload?.services || []) {
        const [prefixes, urls] = service;
        for (const cidr of prefixes || []) {
          try {
            matcher.add(cidr, { urls: (urls || []).filter((url) => /^https:\/\//i.test(url)) });
            records += 1;
          } catch {
            // Ignore malformed bootstrap rows.
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') return emptyLayer(id, 'RDAP bootstrap could not be loaded');
    }
  }
  if (availableFiles === 0 || records === 0) return emptyLayer(id);
  return readyLayer(id, { matcher: matcher.finalize(), complete: availableFiles === filePaths.length }, { mtime: newest }, records);
}

async function loadCaidaLayer(filePath) {
  const id = 'caida-as2org';
  return optionalFile(filePath, async (target, stats) => {
    const content = gunzipSync(await fsp.readFile(target)).toString('utf8');
    const organizations = new Map();
    const pending = [];
    for (const line of content.split(/\r?\n/)) {
      if (!line) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row.type === 'Organization' && row.organizationId) organizations.set(row.organizationId, row);
      if (row.type === 'ASN') pending.push(row);
    }
    const asns = new Map();
    for (const row of pending) {
      const asn = normalizedAsn(row.asn);
      if (asn === null) continue;
      const organization = organizations.get(row.organizationId);
      asns.set(asn, {
        name: organization?.name || row.name || null,
        country: organization?.country || null,
        organizationId: row.organizationId || null,
      });
    }
    if (asns.size === 0) throw new Error('CAIDA snapshot is empty');
    return readyLayer(id, { asns }, stats, asns.size);
  }, id);
}

async function loadPeeringDbLayer(filePath) {
  const id = 'peeringdb-networks';
  return optionalFile(filePath, async (target, stats) => {
    const payload = JSON.parse(await fsp.readFile(target, 'utf8'));
    const asns = new Map();
    for (const row of payload?.networks || []) {
      const asn = normalizedAsn(row?.asn);
      if (asn !== null) asns.set(asn, row);
    }
    if (asns.size === 0) throw new Error('PeeringDB snapshot is empty');
    return readyLayer(id, { asns }, stats, asns.size);
  }, id);
}

function routeFor(layer, ip) {
  if (!layer.available) return null;
  const matches = layer.matcher.lookup(ip);
  if (matches.length === 0) return null;
  const length = Math.max(...matches.map((item) => cidrLength(item.prefix)));
  const selected = matches.filter((item) => cidrLength(item.prefix) === length);
  return {
    prefix: selected[0].prefix,
    asns: [...new Set(selected.flatMap((item) => item.asns))].sort((a, b) => a - b),
    peers: Math.max(...selected.map((item) => item.peers || 0)),
  };
}

function rpkiStatus(layer, ip, route) {
  if (!layer.available || !route) return null;
  const vrps = layer.matcher.lookup(ip);
  if (vrps.length === 0) return 'not_found';
  const routeLength = cidrLength(route.prefix);
  const results = route.asns.map((origin) => {
    const sameAsn = vrps.filter((vrp) => vrp.asn === origin);
    if (sameAsn.some((vrp) => routeLength <= vrp.maxLength)) return 'valid';
    if (sameAsn.length > 0) return 'invalid_length';
    return 'invalid_asn';
  });
  return new Set(results).size > 1 ? 'mixed' : results[0];
}

function safeLookup(layer, ip) {
  if (!layer.available) return [];
  try { return layer.matcher.lookup(ip); } catch { return []; }
}

function peeringNetworkType(value) {
  return ({
    Content: 'cdn',
    Enterprise: 'business',
    'Educational/Research': 'education',
    Government: 'government',
  })[value] || null;
}

export class NetworkEvidenceProvider {
  constructor({ layers, state }) {
    this.id = 'network-evidence';
    this.layers = layers;
    this.state = state;
  }

  static async load(dataDir, now = Date.now) {
    const file = (name) => path.resolve(dataDir, SOURCE_FILES[name]);
    const layers = {};
    layers.iana4 = await loadJsonPrefixLayer(file('iana4'), 'iana-special-ipv4', (payload) => (
      (payload.records || []).map((record) => ({ cidr: record['Address Block'], value: record }))
    ));
    layers.iana6 = await loadJsonPrefixLayer(file('iana6'), 'iana-special-ipv6', (payload) => (
      (payload.records || []).map((record) => ({ cidr: record['Address Block'], value: record }))
    ));
    layers.fullbogons = await loadTextPrefixLayer([file('fullbogons4'), file('fullbogons6')], 'fullbogons');
    layers.crawlers = await NetworkEvidenceProvider.loadCrawlers(dataDir);
    layers.appleRelay = await loadJsonPrefixLayer(file('appleRelay'), 'apple-private-relay-ranges', function* appleEntries(payload) {
      const regions = new Map();
      for (const record of payload.records || []) {
        const key = [record.country_code, record.region_code, record.city].join('|');
        if (!regions.has(key)) {
          regions.set(key, {
            country_code: record.country_code || null,
            region_code: record.region_code || null,
            city: record.city || null,
          });
        }
        yield { cidr: record.cidr, value: regions.get(key) };
      }
    });
    layers.rir = await loadRirLayer(file('rir'));
    layers.rdap = await loadRdapLayer([file('rdap4'), file('rdap6')]);
    layers.rpki = await loadRpkiLayer(file('rpki'));
    layers.ripeRis = await loadRipeRisLayer([file('ripeRis4'), file('ripeRis6')]);
    layers.caida = await loadCaidaLayer(file('caida'));
    layers.peeringDb = await loadPeeringDbLayer(file('peeringDb'));
    const values = Object.values(layers);
    const available = values.filter((layer) => layer.available);
    const newest = available.map((layer) => Date.parse(layer.updatedAt)).filter(Number.isFinite);
    const updatedAt = newest.length ? new Date(Math.max(...newest)).toISOString() : null;
    return new NetworkEvidenceProvider({
      layers,
      state: {
        id: 'network-evidence',
        required: false,
        ready: available.length > 0,
        status: available.length > 0 ? 'ready' : 'unavailable',
        version: `${available.length}/${values.length} evidence layers`,
        updated_at: updatedAt,
        expires_at: updatedAt ? new Date(Date.parse(updatedAt) + 48 * 60 * 60 * 1_000).toISOString() : null,
        message: available.length > 0 ? null : 'Supplemental evidence files are unavailable',
      },
    });
  }

  static async loadCrawlers(dataDir) {
    const definitions = [
      ['googlebot', SOURCE_FILES.googlebot, 'Google', 'Googlebot'],
      ['google-special', SOURCE_FILES.googleSpecial, 'Google', 'Google Special Crawler'],
      ['google-user-triggered', SOURCE_FILES.googleUserTriggered, 'Google', 'Google User-Triggered Fetcher'],
      ['bingbot', SOURCE_FILES.bingbot, 'Microsoft', 'Bingbot'],
    ];
    const matcher = new CompactPrefixMatcher();
    let files = 0;
    let records = 0;
    let newest = null;
    for (const [source, fileName, operator, type] of definitions) {
      try {
        const filePath = path.resolve(dataDir, fileName);
        const [payload, stats] = await Promise.all([fsp.readFile(filePath, 'utf8').then(JSON.parse), fsp.stat(filePath)]);
        newest = !newest || stats.mtime > newest ? stats.mtime : newest;
        files += 1;
        for (const cidr of prefixRows(payload)) {
          try { matcher.add(cidr, { source, operator, type, cidr }); records += 1; } catch { /* ignore */ }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') return emptyLayer('verified-crawlers', 'Crawler range data could not be loaded');
      }
    }
    if (files === 0 || records === 0) return emptyLayer('verified-crawlers');
    return readyLayer('verified-crawlers', { matcher: matcher.finalize(), complete: files === definitions.length }, { mtime: newest }, records);
  }

  lookup(ip, asn = null) {
    const details = {
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
      special_purpose: null,
      is_fullbogon: this.layers.fullbogons.available ? false : null,
      verified_crawler: this.layers.crawlers.available && this.layers.crawlers.complete ? false : null,
      crawler_operator: null,
      crawler_type: null,
      is_private_relay: this.layers.appleRelay.available ? false : null,
      private_relay_region: null,
      canonical_org: null,
      canonical_org_country: null,
      peeringdb_network_type: null,
    };
    const evidence = [];
    const sources = [];
    const assertions = [];

    const ianaLayers = [this.layers.iana4, this.layers.iana6];
    const special = ianaLayers.flatMap((layer) => safeLookup(layer, ip))[0];
    if (ianaLayers.some((layer) => layer.available)) sources.push('iana-special');
    if (special) {
      details.special_purpose = special.Name || 'Special-Purpose Address';
      evidence.push({ source: 'iana-special', field: 'special_purpose', value: details.special_purpose, confidence: 'high' });
    }

    const bogon = safeLookup(this.layers.fullbogons, ip)[0];
    if (this.layers.fullbogons.available) sources.push('fullbogons');
    if (bogon) {
      details.is_fullbogon = true;
      evidence.push({ source: 'fullbogons', field: 'is_fullbogon', value: 'true', confidence: 'medium' });
    }

    const crawler = safeLookup(this.layers.crawlers, ip)[0];
    if (this.layers.crawlers.available) sources.push('verified-crawlers');
    if (crawler) {
      details.verified_crawler = true;
      details.crawler_operator = crawler.operator;
      details.crawler_type = crawler.type;
      evidence.push({ source: crawler.source, field: 'verified_crawler', value: `${crawler.operator}:${crawler.type}`, confidence: 'high' });
    }

    const relay = safeLookup(this.layers.appleRelay, ip)[0];
    if (this.layers.appleRelay.available) sources.push('apple-private-relay-ranges');
    if (relay) {
      details.is_private_relay = true;
      details.private_relay_region = [relay.country_code, relay.region_code, relay.city].filter(Boolean).join(' / ') || null;
      evidence.push({ source: 'apple-private-relay-ranges', field: 'is_private_relay', value: details.private_relay_region || 'true', confidence: 'high' });
    }

    const route = routeFor(this.layers.ripeRis, ip);
    if (this.layers.ripeRis.available) sources.push('ripe-ris');
    if (route) {
      details.bgp_origin_asns = route.asns;
      details.bgp_origin_asn = route.asns.length === 1 ? route.asns[0] : null;
      details.bgp_prefix = route.prefix;
      details.bgp_conflict = Number.isSafeInteger(asn) ? !route.asns.includes(asn) : null;
      evidence.push({ source: 'ripe-ris', field: 'bgp_origin_asn', value: route.asns.map((item) => `AS${item}`).join(','), confidence: 'high' });
      evidence.push({ source: 'ripe-ris', field: 'bgp_prefix', value: route.prefix, confidence: 'high' });
      if (details.bgp_conflict) evidence.push({ source: 'ripe-ris', field: 'asn_conflict', value: `database=AS${asn}; bgp=${route.asns.map((item) => `AS${item}`).join(',')}`, confidence: 'high' });
    }

    details.rpki_status = rpkiStatus(this.layers.rpki, ip, route);
    if (this.layers.rpki.available) sources.push('rpki-vrps');
    if (details.rpki_status) evidence.push({ source: 'rpki-vrps', field: 'rpki_status', value: details.rpki_status, confidence: 'high' });

    if (this.layers.rir.available) {
      sources.push('nro-rir-delegated');
      let allocation = null;
      try {
        const address = ipaddr.parse(ip);
        allocation = address.kind() === 'ipv4'
          ? findIpv4Range(this.layers.rir.ipv4, ipv4Number(ip))
          : this.layers.rir.ipv6.lookup(ip)[0] || null;
      } catch { /* ignore */ }
      if (allocation) {
        details.rir = allocation.registry;
        details.allocation_country = allocation.country;
        details.allocation_status = allocation.status;
        details.allocation_date = allocation.date;
        evidence.push({ source: 'nro-rir-delegated', field: 'resource_registration', value: [allocation.registry, allocation.country, allocation.status].filter(Boolean).join(':'), confidence: 'high' });
      }
    }

    if (this.layers.rdap.available) {
      sources.push('iana-rdap-bootstrap');
      details.rdap_urls = [...new Set(safeLookup(this.layers.rdap, ip).flatMap((entry) => entry.urls || []))];
      if (details.rdap_urls.length > 0) evidence.push({ source: 'iana-rdap-bootstrap', field: 'rdap_service', value: details.rdap_urls[0], confidence: 'high' });
    }

    const normalized = normalizedAsn(asn);
    if (normalized !== null && this.layers.caida.available) {
      sources.push('caida-as2org');
      const organization = this.layers.caida.asns.get(normalized);
      if (organization) {
        details.canonical_org = organization.name;
        details.canonical_org_country = organization.country;
        evidence.push({ source: 'caida-as2org', field: 'canonical_org', value: organization.name, confidence: 'high' });
      }
    }

    if (normalized !== null && this.layers.peeringDb.available) {
      sources.push('peeringdb-networks');
      const network = this.layers.peeringDb.asns.get(normalized);
      if (network) {
        details.peeringdb_network_type = network.info_type || null;
        evidence.push({ source: 'peeringdb-networks', field: 'peeringdb_network_type', value: network.info_type || network.name, confidence: 'medium' });
        const networkType = peeringNetworkType(network.info_type);
        if (networkType) assertions.push({ field: 'network_type', value: networkType, source: 'peeringdb-networks', confidence: 'medium', priority: 450 });
      }
    }

    return { details, evidence, sources: [...new Set(sources)], assertions };
  }

  publicState() {
    return { ...this.state };
  }
}
