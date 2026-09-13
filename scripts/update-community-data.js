import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import yauzl from 'yauzl';
import maxmind from 'maxmind';
import ipaddr from 'ipaddr.js';
import { loadConfig } from '../src/config.js';

const [source] = process.argv.slice(2);
const config = loadConfig();
const agent = 'ip-intelligence-service-data-updater/1.0';
const maxBytes = 1024 * 1024 * 1024;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const validCidr = (value) => { try { ipaddr.parseCIDR(value); return true; } catch { return false; } };

function get(url, headers = {}, redirects = 4) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'user-agent': agent, accept: '*/*', ...headers } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume(); return redirects ? resolve(get(new URL(response.headers.location, url), headers, redirects - 1)) : reject(new Error('Too many redirects'));
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`Download failed with HTTP ${response.statusCode}`)); }
      const chunks = []; let bytes = 0;
      response.on('data', (chunk) => { bytes += chunk.length; if (bytes > maxBytes) response.destroy(new Error('Download is too large')); else chunks.push(chunk); });
      response.on('end', () => resolve(Buffer.concat(chunks))); response.on('error', reject);
    });
    request.setTimeout(180000, () => request.destroy(new Error('Download timed out'))); request.on('error', reject);
  });
}

async function atomic(file, content) { const temp = `${file}.tmp-${process.pid}-${randomUUID()}`; await fs.writeFile(temp, content, { mode: 0o600 }); await fs.rename(temp, file); }
function report(id, file, content, records, version = new Date().toISOString().slice(0, 10)) { return { id, file, records, bytes: content.length, sha256: sha256(content), version, updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 48 * 3600000).toISOString() }; }
async function unzipMmdb(content) {
  const temp = path.join(config.dataDir, `.download-${process.pid}-${randomUUID()}.zip`);
  await fs.writeFile(temp, content, { mode: 0o600 });
  try {
    return await new Promise((resolve, reject) => {
      yauzl.open(temp, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
        if (error) return reject(error);
        zip.on('entry', (entry) => {
          if (!/\.mmdb$/i.test(entry.fileName) || /(^|\/)\.\.?\//.test(entry.fileName)) { zip.readEntry(); return; }
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError) return reject(streamError);
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('error', reject);
            stream.on('end', () => { zip.close(); resolve(Buffer.concat(chunks)); });
          });
        });
        zip.on('end', () => reject(new Error('Zip contains no MMDB file')));
        zip.on('error', reject);
        zip.readEntry();
      });
    });
  } finally { await fs.rm(temp, { force: true }); }
}

async function github() { const token = String(process.env.GITHUB_META_TOKEN || '').trim(); const payload = JSON.parse((await get('https://api.github.com/meta', token ? { authorization: `Bearer ${token}`, 'x-github-api-version': '2026-03-10' } : {})).toString()); const ranges = [...new Set(Object.values(payload).flat().filter((x) => typeof x === 'string' && validCidr(x)))].map((cidr) => ({ cidr, provider: 'github', service: 'GitHub Meta', network_type: 'hosting' })); if (ranges.length < 5) throw new Error('GitHub Meta returned too few CIDRs'); const out = Buffer.from(JSON.stringify({ updated_at: new Date().toISOString(), ranges }) + '\n'); await atomic(path.join(config.dataDir, 'github-meta-ranges.json'), out); return [report('github-meta-ranges', 'github-meta-ranges.json', out, ranges.length)]; }
async function geolite() { const account = String(process.env.MAXMIND_ACCOUNT_ID || '').trim(); const key = String(process.env.MAXMIND_LICENSE_KEY || '').trim(); if (!account || !key) throw new Error('MaxMind credentials are not configured in server credential storage'); const basic = `Basic ${Buffer.from(`${account}:${key}`).toString('base64')}`; const definitions = [['Country', 'maxmind-geolite2-country.mmdb'], ['City', 'maxmind-geolite2-city.mmdb'], ['ASN', 'maxmind-geolite2-asn.mmdb']]; const output = []; for (const [edition, file] of definitions) { const zip = await get(`https://download.maxmind.com/geoip/databases/GeoLite2-${edition}/download?edition_id=GeoLite2-${edition}&suffix=zip`, { authorization: basic }); const mmdb = await unzipMmdb(zip); const temp = path.join(config.dataDir, `.${file}-${randomUUID()}`); await fs.writeFile(temp, mmdb, { mode: 0o600 }); try { const reader = await maxmind.open(temp); if (!reader.get('8.8.8.8')) throw new Error(`GeoLite2 ${edition} failed MMDB validation`); await atomic(path.join(config.dataDir, file), mmdb); output.push(report(`maxmind-geolite2-${edition.toLowerCase()}`, file, mmdb, 1, reader.metadata?.buildEpoch?.toISOString?.().slice(0, 10))); } finally { await fs.rm(temp, { force: true }); } } return output; }
async function spamhaus() { const output = []; for (const [id, url, file] of [['spamhaus-drop-v4', 'https://www.spamhaus.org/drop/drop_v4.json', 'spamhaus-drop-v4.json'], ['spamhaus-drop-v6', 'https://www.spamhaus.org/drop/drop_v6.json', 'spamhaus-drop-v6.json']]) { const raw = await get(url); const payload = JSON.parse(raw.toString()); const records = (payload.drop || payload).filter?.((x) => validCidr(x?.cidr || x?.prefix || x)) || []; if (records.length < 1) throw new Error(`${id} has no valid CIDRs`); const out = Buffer.from(JSON.stringify({ attribution: 'Spamhaus Project © Spamhaus', source_date: new Date().toISOString(), records }) + '\n'); await atomic(path.join(config.dataDir, file), out); output.push(report(id, file, out, records.length)); } return output; }
async function ipgeo() { const release = JSON.parse((await get('https://api.github.com/repos/whois-api-llc/ipgeo-community/releases/latest')).toString()); const assets = new Map((release.assets || []).map((x) => [x.name, x.browser_download_url])); const mmdb = await get(assets.get('ipgeo-community.mmdb')); await maxmind.open(await (async () => { const t = path.join(config.dataDir, `.ipgeo-${randomUUID()}`); await fs.writeFile(t, mmdb); return t; })()).catch(() => { throw new Error('ipgeo MMDB validation failed'); }); await atomic(path.join(config.dataDir, 'ipgeo-community.mmdb'), mmdb); const vpn = await get(assets.get('community-vpn-list.csv.gz')); await atomic(path.join(config.dataDir, 'ipgeo-community-vpn.csv.gz'), vpn); return [report('ipgeo-community-mmdb', 'ipgeo-community.mmdb', mmdb, 1, release.tag_name), report('ipgeo-community-vpn', 'ipgeo-community-vpn.csv.gz', vpn, 1, release.tag_name)]; }
async function ipsum() { const raw = await get('https://raw.githubusercontent.com/stamparm/ipsum/master/ipsum.txt'); const rows = raw.toString().split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\d{1,3}(?:\.\d{1,3}){3}\s+\d+$/.test(line)).map((line) => { const [ip, occurrences] = line.split(/\s+/); return { ip, occurrences: Number(occurrences) }; }); if (rows.length < 100) throw new Error('IPsum contains too few records'); const out = Buffer.from(JSON.stringify({ source: 'IPsum', updated_at: new Date().toISOString(), records: rows }) + '\n'); await atomic(path.join(config.dataDir, 'ipsum-reputation.json'), out); return [report('ipsum-reputation', 'ipsum-reputation.json', out, rows.length)]; }

await fs.mkdir(config.dataDir, { recursive: true });
const handlers = { 'github-meta': github, 'maxmind-geolite2': geolite, 'spamhaus-drop': spamhaus, 'ipgeo-community': ipgeo, ipsum };
if (!handlers[source]) throw new Error(`Unsupported community source: ${source || 'missing'}`);
process.stdout.write(`${JSON.stringify({ status: 'updated', updated: true, source_id: source, sources: await handlers[source]() })}\n`);
