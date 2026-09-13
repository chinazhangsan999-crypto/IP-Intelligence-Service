import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { createGunzip, gunzipSync } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { loadConfig } from '../src/config.js';

const execFileAsync = promisify(execFile);
const sourceId = process.argv[2];
const MAX_BYTES = 512 * 1024 * 1024;
const USER_AGENT = 'ip-intelligence-service-data-updater/1.0';

function accepted(name) {
  return ['1', 'true'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function requestBuffer(url, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { family: 4, headers: { 'user-agent': USER_AGENT, accept: '*/*' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects: ${url}`));
        return resolve(requestBuffer(new URL(response.headers.location, url), redirectsLeft - 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
      }
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_BYTES) {
        response.destroy();
        return reject(new Error(`Download is larger than ${MAX_BYTES} bytes: ${url}`));
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BYTES) return response.destroy(new Error(`Download is larger than ${MAX_BYTES} bytes: ${url}`));
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(180_000, () => request.destroy(new Error(`Download timed out: ${url}`)));
    request.on('error', reject);
  });
}

async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await requestBuffer(url);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

function requestInternalBuffer(url) {
  const target = new URL(url);
  const allowedHosts = new Set(['routinator', 'localhost', '127.0.0.1', '[::1]']);
  if (target.protocol !== 'http:' || !allowedHosts.has(target.hostname) || target.pathname !== '/json') {
    throw new Error('ROUTINATOR_URL must be an internal HTTP /json endpoint');
  }
  return new Promise((resolve, reject) => {
    const request = http.get(target, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Routinator returned HTTP ${response.statusCode}`));
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BYTES) return response.destroy(new Error('Routinator response is too large'));
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(60_000, () => request.destroy(new Error('Routinator request timed out')));
    request.on('error', reject);
  });
}

async function atomicWrite(filePath, content) {
  const token = `${process.pid}-${randomUUID()}`;
  const temporary = `${filePath}.tmp-${token}`;
  const backup = `${filePath}.backup-${token}`;
  let backedUp = false;
  let installed = false;
  await fs.writeFile(temporary, content, { mode: 0o600 });
  try {
    try {
      await fs.rename(filePath, backup);
      backedUp = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.rename(temporary, filePath);
    installed = true;
    if (backedUp) await fs.rm(backup, { force: true });
  } catch (error) {
    await fs.rm(temporary, { force: true });
    if (installed) await fs.rm(filePath, { force: true });
    if (backedUp) await fs.rename(backup, filePath);
    throw error;
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function sourceResult(id, fileName, content, { records = null, version = null, expiresHours = 48 } = {}) {
  const updatedAt = new Date().toISOString();
  return {
    id,
    file: fileName,
    sha256: sha256(content),
    bytes: content.length,
    records,
    version: version || updatedAt.slice(0, 10),
    updated_at: updatedAt,
    expires_at: new Date(Date.now() + expiresHours * 60 * 60 * 1_000).toISOString(),
  };
}

async function installDownloaded(id, fileName, url, validate, options = {}) {
  const content = await download(url);
  const validation = await validate(content);
  const target = path.join(config.dataDir, fileName);
  await atomicWrite(target, content);
  return sourceResult(id, fileName, content, { ...options, ...validation });
}

function parseJson(content, label) {
  try {
    return JSON.parse(content.toString('utf8'));
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

function csvRows(content) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const text = content.toString('utf8').replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function officialPrefixCount(payload) {
  return (payload?.prefixes || [])
    .filter((entry) => validCidr(entry?.ipv4Prefix || entry?.ipv6Prefix))
    .length;
}

async function countGzipLines(content, pattern) {
  const stream = Readable.from(content).pipe(createGunzip());
  let remainder = '';
  let count = 0;
  for await (const chunk of stream) {
    const lines = `${remainder}${chunk.toString('utf8')}`.split(/\r?\n/);
    remainder = lines.pop() || '';
    for (const line of lines) if (pattern.test(line)) count += 1;
  }
  if (remainder && pattern.test(remainder)) count += 1;
  return count;
}

async function updateRipeRis() {
  const definitions = [
    ['ripe-ris-ipv4', 'riswhoisdump.IPv4.gz', 'https://www.ris.ripe.net/dumps/riswhoisdump.IPv4.gz'],
    ['ripe-ris-ipv6', 'riswhoisdump.IPv6.gz', 'https://www.ris.ripe.net/dumps/riswhoisdump.IPv6.gz'],
  ];
  const sources = [];
  // Keep peak memory predictable: the two global route dumps are intentionally downloaded in sequence.
  for (const [id, fileName, url] of definitions) {
    sources.push(await installDownloaded(id, fileName, url, async (content) => {
      const records = await countGzipLines(content, /^(?:\d+|\{\d+(?:,\d+)*\})\s+\S+\/\d+\s+\d+/);
      if (records < 1_000) throw new Error(`${id} contains too few route records`);
      return { records, version: new Date().toISOString().slice(0, 10) };
    }, { expiresHours: 36 }));
  }
  return sources;
}

async function updateRouteViews() {
  return [await installDownloaded(
    'routeviews-api',
    'routeviews-collectors.json',
    'https://api.routeviews.org/meta/collectors',
    (content) => {
      const payload = parseJson(content, 'RouteViews collectors');
      const collectors = payload?.data?.collectors || payload?.collectors;
      if (!collectors || typeof collectors !== 'object' || Object.keys(collectors).length < 2) {
        throw new Error('RouteViews collector metadata is unexpectedly small');
      }
      return { records: Object.keys(collectors).length, version: new Date(Number(payload.time || 0) * 1_000).toISOString().slice(0, 10) };
    },
    { expiresHours: 12 },
  )];
}

async function updateRpki() {
  const temporary = path.join(config.dataDir, `rpki-vrps.tmp-${process.pid}-${randomUUID()}.json`);
  const target = path.join(config.dataDir, 'rpki-vrps.json');
  try {
    const routinatorUrl = String(process.env.ROUTINATOR_URL || '').trim();
    let content;
    if (routinatorUrl) {
      content = await requestInternalBuffer(routinatorUrl);
    } else {
      await execFileAsync(process.env.ROUTINATOR_BIN || 'routinator', ['vrps', '--format', 'json', '--output', temporary], {
        timeout: 15 * 60 * 1_000,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      content = await fs.readFile(temporary);
    }
    const payload = parseJson(content, 'Routinator');
    if (!Array.isArray(payload.roas) || payload.roas.length < 1_000) throw new Error('Routinator returned too few VRPs');
    await atomicWrite(target, content);
    return [sourceResult('rpki-vrps', 'rpki-vrps.json', content, {
      records: payload.roas.length,
      version: payload.metadata?.generatedTime || new Date().toISOString(),
      expiresHours: 12,
    })];
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Routinator is unavailable; configure the internal ROUTINATOR_URL or install the local binary');
    throw error;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function updateNroRir() {
  const url = 'https://ftp.ripe.net/pub/stats/ripencc/nro-stats/latest/nro-delegated-stats';
  return [await installDownloaded('nro-rir-delegated', 'nro-delegated-stats.txt', url, (content) => {
    const text = content.toString('utf8');
    const records = text.split('\n').filter((line) => /^[a-z]+\|[A-Z*]{2}\|(asn|ipv4|ipv6)\|/.test(line)).length;
    if (records < 100_000) throw new Error('NRO delegated statistics contain too few records');
    return { records, version: text.match(/^2\|[^|]+\|\d+\|\d+\|([^|]+)/m)?.[1] || new Date().toISOString().slice(0, 10) };
  }, { expiresHours: 48 })];
}

async function updateRdap() {
  const definitions = [
    ['rdap-ipv4', 'rdap-ipv4.json', 'https://data.iana.org/rdap/ipv4.json'],
    ['rdap-ipv6', 'rdap-ipv6.json', 'https://data.iana.org/rdap/ipv6.json'],
    ['rdap-asn', 'rdap-asn.json', 'https://data.iana.org/rdap/asn.json'],
  ];
  return Promise.all(definitions.map(([id, fileName, url]) => installDownloaded(id, fileName, url, (content) => {
    const payload = parseJson(content, id);
    if (!Array.isArray(payload.services) || payload.services.length < 2) throw new Error(`${id} bootstrap is unexpectedly small`);
    return { records: payload.services.length, version: payload.publication || new Date().toISOString().slice(0, 10) };
  }, { expiresHours: 240 })));
}

async function updateIanaSpecial() {
  const definitions = [
    ['iana-ipv4-special', 'iana-ipv4-special-registry.json', 'https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv'],
    ['iana-ipv6-special', 'iana-ipv6-special-registry.json', 'https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv'],
  ];
  const sources = [];
  for (const [id, fileName, url] of definitions) {
    const downloaded = await download(url);
    const rows = csvRows(downloaded);
    const headers = rows.shift() || [];
    if (!headers.includes('Address Block')) throw new Error(`${id} is missing the Address Block column`);
    const records = rows
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
      .filter((record) => validCidr(record['Address Block']));
    if (records.length < 10) throw new Error(`${id} registry is unexpectedly small`);
    const updatedAt = new Date().toISOString();
    const output = Buffer.from(`${JSON.stringify({ version: updatedAt.slice(0, 10), updated_at: updatedAt, records })}\n`);
    await atomicWrite(path.join(config.dataDir, fileName), output);
    sources.push(sourceResult(id, fileName, output, { records: records.length, expiresHours: 24 * 8 }));
  }
  return sources;
}

async function updateFullbogons() {
  const definitions = [
    ['fullbogons-ipv4', 'fullbogons-ipv4.txt', 'https://www.team-cymru.org/Services/Bogons/fullbogons-ipv4.txt'],
    ['fullbogons-ipv6', 'fullbogons-ipv6.txt', 'https://www.team-cymru.org/Services/Bogons/fullbogons-ipv6.txt'],
  ];
  return Promise.all(definitions.map(([id, fileName, url]) => installDownloaded(id, fileName, url, (content) => {
    const lines = content.toString('utf8').split(/\r?\n/);
    const records = lines.filter((line) => validCidr(line.trim())).length;
    if (records < 100) throw new Error(`${id} contains too few valid prefixes`);
    const version = lines.find((line) => /^#\s*Last-Modified:/i.test(line))?.split(':').slice(1).join(':').trim()
      || new Date().toISOString().slice(0, 10);
    return { records, version };
  }, { expiresHours: 48 })));
}

async function updateVerifiedCrawlers() {
  const definitions = [
    ['googlebot-ranges', 'googlebot-ranges.json', 'https://developers.google.com/static/search/apis/ipranges/googlebot.json'],
    ['google-special-crawlers', 'google-special-crawlers.json', 'https://developers.google.com/static/search/apis/ipranges/special-crawlers.json'],
    ['google-user-triggered-fetchers', 'google-user-triggered-fetchers.json', 'https://developers.google.com/static/search/apis/ipranges/user-triggered-fetchers.json'],
    ['bingbot-ranges', 'bingbot-ranges.json', 'https://www.bing.com/toolbox/bingbot.json'],
  ];
  const settled = await Promise.allSettled(definitions.map(([id, fileName, url]) => installDownloaded(
    id,
    fileName,
    url,
    (content) => {
      const payload = parseJson(content, id);
      const records = officialPrefixCount(payload);
      if (records < 5) throw new Error(`${id} contains too few valid prefixes`);
      return { records, version: payload.creationTime || new Date().toISOString().slice(0, 10) };
    },
    { expiresHours: 48 },
  )));
  if (!settled.some((result) => result.status === 'fulfilled')) {
    throw new Error('Every official crawler source failed validation or download');
  }
  return settled.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : { id: definitions[index][0], status: 'failed', error: result.reason?.message || 'Source update failed' });
}

async function updateApplePrivateRelay() {
  const content = await download('https://mask-api.icloud.com/egress-ip-ranges.csv');
  const rows = csvRows(content).filter((row) => validCidr(row[0]?.trim()));
  if (rows.length < 1_000) throw new Error('Apple Private Relay returned too few valid prefixes');
  const updatedAt = new Date().toISOString();
  const records = rows.map(([cidr, countryCode = '', regionCode = '', city = '']) => ({
    cidr: cidr.trim(),
    country_code: countryCode || null,
    region_code: regionCode || null,
    city: city || null,
  }));
  const output = Buffer.from(`${JSON.stringify({ version: updatedAt.slice(0, 10), updated_at: updatedAt, records })}\n`);
  await atomicWrite(path.join(config.dataDir, 'apple-private-relay-ranges.json'), output);
  return [sourceResult('apple-private-relay-ranges', 'apple-private-relay-ranges.json', output, {
    records: records.length,
    version: updatedAt.slice(0, 10),
    expiresHours: 48,
  })];
}

async function updateCaida() {
  if (!accepted('CAIDA_AUA_ACCEPTED')) throw new Error('CAIDA_AUA_ACCEPTED=1 is required before downloading CAIDA data');
  return [await installDownloaded(
    'caida-as2org',
    'caida-as2org.jsonl.gz',
    'https://data.caida.org/datasets/as-organizations/latest.as-org2info.jsonl.gz',
    (content) => {
      const text = gunzipSync(content).toString('utf8');
      const records = text.split('\n').filter(Boolean).length;
      if (records < 10_000) throw new Error('CAIDA AS2Org contains too few records');
      return { records, version: new Date().toISOString().slice(0, 10) };
    },
    { expiresHours: 24 * 40 },
  )];
}

async function updatePeeringDb() {
  if (!accepted('PEERINGDB_AUP_ACCEPTED')) throw new Error('PEERINGDB_AUP_ACCEPTED=1 is required before downloading PeeringDB data');
  const fields = 'id,asn,name,aka,name_long,info_type,info_scope,status,updated';
  const content = await download(`https://www.peeringdb.com/api/net?depth=0&fields=${fields}`);
  const payload = parseJson(content, 'PeeringDB');
  const rows = (Array.isArray(payload.data) ? payload.data : []).map((row) => ({
    id: row.id,
    asn: row.asn,
    name: row.name,
    aka: row.aka,
    name_long: row.name_long,
    info_type: row.info_type,
    info_scope: row.info_scope,
    status: row.status,
    updated: row.updated,
  }));
  if (rows.length < 1_000) throw new Error('PeeringDB returned too few networks');
  const output = Buffer.from(`${JSON.stringify({ updated_at: new Date().toISOString(), networks: rows })}\n`);
  await atomicWrite(path.join(config.dataDir, 'peeringdb-networks.json'), output);
  return [sourceResult('peeringdb-networks', 'peeringdb-networks.json', output, { records: rows.length, expiresHours: 48 })];
}

function decodeMicrosoftDownloadHtml(content) {
  return content.toString('utf8')
    .replaceAll('\\/', '/')
    .replaceAll('&amp;', '&')
    .replaceAll('\\u0026', '&');
}

async function resolveMicrosoftServiceTagsUrl(downloadId, filePrefix) {
  const detailsUrl = `https://www.microsoft.com/en-us/download/details.aspx?id=${downloadId}`;
  const html = decodeMicrosoftDownloadHtml(await download(detailsUrl));
  const candidates = html.match(/https:\/\/download\.microsoft\.com\/[^\s"'<>]+\.json/gi) || [];
  const selected = candidates.find((url) => new URL(url).pathname.split('/').at(-1)?.startsWith(filePrefix));
  if (!selected) throw new Error(`Microsoft Download Center did not expose the current ${filePrefix} JSON URL`);
  return selected;
}

async function updateAzureServiceTags({ downloadId, filePrefix, source, provider, fileName }) {
  const url = await resolveMicrosoftServiceTagsUrl(downloadId, filePrefix);
  const content = await download(url);
  const payload = parseJson(content, source);
  const ranges = [];
  for (const value of payload.values || []) {
    for (const cidr of value?.properties?.addressPrefixes || []) {
      if (!validCidr(cidr)) continue;
      ranges.push({
        cidr,
        provider,
        service: value.name || provider,
        region: value.properties?.region || null,
        network_type: 'hosting',
      });
    }
  }
  if (ranges.length < 100) throw new Error(`${source} returned too few valid CIDR records`);
  const updatedAt = new Date().toISOString();
  const output = Buffer.from(`${JSON.stringify({
    version: String(payload.changeNumber || new URL(url).pathname.split('/').at(-1) || updatedAt.slice(0, 10)),
    updated_at: updatedAt,
    source_url: url,
    ranges,
  })}\n`);
  await atomicWrite(path.join(config.dataDir, fileName), output);
  return [sourceResult(source, fileName, output, {
    records: ranges.length,
    version: String(payload.changeNumber || updatedAt.slice(0, 10)),
    expiresHours: 24 * 8,
  })];
}

function validCidr(value) {
  try { ipaddr.parseCIDR(value); return true; } catch { return false; }
}

function collectCidrs(value, results = new Set()) {
  if (typeof value === 'string') {
    for (const token of value.split(/[\s,]+/)) if (validCidr(token.trim())) results.add(token.trim());
    return results;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCidrs(item, results);
    return results;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectCidrs(item, results);
  }
  return results;
}

async function updateConfiguredCloud({ environmentName, source, provider, networkType, fileName }) {
  const url = String(process.env[environmentName] || '').trim();
  if (!url) throw new Error(`${environmentName} is required before this source can be enabled`);
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error(`${environmentName} must use HTTPS`);
  const content = await download(target);
  let input;
  try { input = JSON.parse(content.toString('utf8')); } catch { input = content.toString('utf8'); }
  const ranges = [...collectCidrs(input)].map((cidr) => ({ cidr, provider, service: provider.toUpperCase(), network_type: networkType }));
  if (ranges.length < 10) throw new Error(`${source} returned too few valid CIDR records`);
  const output = Buffer.from(`${JSON.stringify({ version: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString(), ranges })}\n`);
  await atomicWrite(path.join(config.dataDir, fileName), output);
  return [sourceResult(source, fileName, output, { records: ranges.length, expiresHours: 24 * 8 })];
}

async function updateCloudExtended() {
  const definitions = [
    {
      id: 'oracle-cloud-ranges',
      provider: 'oracle-cloud',
      load: async () => {
        const payload = parseJson(await download('https://docs.oracle.com/iaas/tools/public_ip_ranges.json'), 'Oracle Cloud');
        const ranges = [];
        for (const region of payload.regions || []) for (const item of region.cidrs || []) {
          if (validCidr(item.cidr)) ranges.push({ cidr: item.cidr, provider: 'oracle-cloud', service: (item.tags || []).join(','), network_type: 'hosting' });
        }
        return ranges;
      },
    },
    {
      id: 'fastly-ranges',
      provider: 'fastly',
      load: async () => {
        const payload = parseJson(await download('https://api.fastly.com/public-ip-list'), 'Fastly');
        return [...(payload.addresses || []), ...(payload.ipv6_addresses || [])]
          .filter(validCidr)
          .map((cidr) => ({ cidr, provider: 'fastly', service: 'FASTLY', network_type: 'cdn' }));
      },
    },
    {
      id: 'digitalocean-ranges',
      provider: 'digitalocean',
      load: async () => (await download('https://digitalocean.com/geo/google.csv')).toString('utf8')
        .split(/\r?\n/)
        .map((line) => line.split(',')[0]?.trim())
        .filter(validCidr)
        .map((cidr) => ({ cidr, provider: 'digitalocean', service: 'DIGITALOCEAN', network_type: 'hosting' })),
    },
  ];
  const target = path.join(config.dataDir, 'cloud-ranges-extended.json');
  let existingRanges = [];
  try {
    existingRanges = parseJson(await fs.readFile(target), 'Existing extended cloud ranges').ranges || [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const settled = await Promise.allSettled(definitions.map((definition) => definition.load()));
  const successfulProviders = new Set();
  const freshRanges = [];
  for (let index = 0; index < settled.length; index += 1) {
    if (settled[index].status !== 'fulfilled') continue;
    if (settled[index].value.length < 1) continue;
    successfulProviders.add(definitions[index].provider);
    freshRanges.push(...settled[index].value);
  }
  if (successfulProviders.size === 0) {
    throw new Error(settled.map((item, index) => `${definitions[index].id}: ${item.reason?.message || 'empty result'}`).join('; '));
  }
  const ranges = [
    ...existingRanges.filter((range) => !successfulProviders.has(range.provider)),
    ...freshRanges,
  ];
  if (ranges.length < 10) throw new Error('Extended cloud ranges contain too few records');
  const output = Buffer.from(`${JSON.stringify({ version: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString(), ranges })}\n`);
  await atomicWrite(target, output);
  return definitions.map((definition, index) => settled[index].status === 'fulfilled' && settled[index].value.length > 0
    ? sourceResult(definition.id, 'cloud-ranges-extended.json', output, { records: settled[index].value.length, expiresHours: 48 })
    : { id: definition.id, status: 'failed', error: settled[index].reason?.message || 'Source returned no valid CIDR records' });
}

const handlers = new Map([
  ['ripe-ris', updateRipeRis],
  ['routeviews', updateRouteViews],
  ['rpki', updateRpki],
  ['nro-rir', updateNroRir],
  ['rdap', updateRdap],
  ['iana-special', updateIanaSpecial],
  ['fullbogons', updateFullbogons],
  ['verified-crawlers', updateVerifiedCrawlers],
  ['apple-private-relay', updateApplePrivateRelay],
  ['caida-as2org', updateCaida],
  ['peeringdb', updatePeeringDb],
  ['cloud-extended', updateCloudExtended],
  ['azure-public', () => updateAzureServiceTags({ downloadId: 56519, filePrefix: 'ServiceTags_Public_', source: 'azure-public-service-tags', provider: 'azure-public', fileName: 'azure-public-service-tags.json' })],
  ['azure-china', () => updateAzureServiceTags({ downloadId: 57062, filePrefix: 'ServiceTags_China_', source: 'azure-china-service-tags', provider: 'azure-china', fileName: 'azure-china-service-tags.json' })],
  ['akamai-ranges', () => updateConfiguredCloud({ environmentName: 'AKAMAI_CIDR_URL', source: 'akamai-official-ranges', provider: 'akamai', networkType: 'cdn', fileName: 'akamai-ranges.json' })],
]);

if (!handlers.has(sourceId)) throw new Error(`Unsupported evidence source: ${sourceId || 'missing'}`);
const config = loadConfig();
await fs.mkdir(config.dataDir, { recursive: true });
const sources = await handlers.get(sourceId)();
process.stdout.write(`${JSON.stringify({ status: 'updated', updated: true, source_id: sourceId, sources })}\n`);
