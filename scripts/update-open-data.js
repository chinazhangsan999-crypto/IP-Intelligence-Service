import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import https from 'node:https';
import path from 'node:path';
import ipaddr from 'ipaddr.js';
import { loadConfig } from '../src/config.js';

const URLS = Object.freeze({
  aws: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
  gcp: 'https://www.gstatic.com/ipranges/cloud.json',
  cloudflare4: 'https://www.cloudflare.com/ips-v4',
  cloudflare6: 'https://www.cloudflare.com/ips-v6',
  tor: 'https://check.torproject.org/exit-addresses',
  torOnionoo: 'https://onionoo.torproject.org/details?type=relay&running=true&flag=Exit&fields=exit_addresses',
});
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

function downloadOnce(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      family: 4,
      headers: { 'user-agent': 'ip-intelligence-service-data-updater/1.0' },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectsLeft === 0) {
          reject(new Error(`Too many redirects: ${url}`));
          return;
        }
        resolve(downloadOnce(new URL(response.headers.location, url), redirectsLeft - 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
        return;
      }
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
        response.destroy();
        reject(new Error(`Download is larger than allowed: ${url}`));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_DOWNLOAD_BYTES) {
          response.destroy(new Error(`Download is larger than allowed: ${url}`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.setTimeout(20_000, () => request.destroy(new Error(`Download timed out: ${url}`)));
    request.on('error', reject);
  });
}

async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await downloadOnce(url);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Unable to update ${url}: ${lastError.message}`);
}

function validCidr(cidr) {
  try {
    ipaddr.parseCIDR(cidr);
    return true;
  } catch {
    return false;
  }
}

function cloudflareRanges(content) {
  return content.split(/\r?\n/).map((line) => line.trim()).filter(validCidr).map((cidr) => ({
    cidr,
    provider: 'cloudflare',
    service: 'CLOUDFLARE',
    network_type: 'cdn',
  }));
}

function awsRanges(payload) {
  return [
    ...(payload.prefixes || []).map((item) => ({ cidr: item.ip_prefix, ...item })),
    ...(payload.ipv6_prefixes || []).map((item) => ({ cidr: item.ipv6_prefix, ...item })),
  ].filter((item) => validCidr(item.cidr)).map((item) => ({
    cidr: item.cidr,
    provider: 'aws',
    service: item.service || 'AMAZON',
    network_type: String(item.service || '').startsWith('CLOUDFRONT') ? 'cdn' : 'hosting',
  }));
}

function gcpRanges(payload) {
  return (payload.prefixes || []).map((item) => item.ipv4Prefix || item.ipv6Prefix).filter(validCidr).map((cidr) => ({
    cidr,
    provider: 'gcp',
    service: 'GOOGLE_CLOUD',
    network_type: 'hosting',
  }));
}

function normalizeAddresses(addresses) {
  return [...new Set(addresses.filter((ip) => ipaddr.isValid(ip)).map(
    (ip) => ipaddr.parse(ip).toString(),
  ))].sort();
}

function torAddresses(content) {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{')) {
    const payload = JSON.parse(content);
    return normalizeAddresses((payload.relays || []).flatMap((relay) => relay.exit_addresses || []));
  }
  return normalizeAddresses(content.split(/\r?\n/).filter(
    (line) => line.startsWith('ExitAddress '),
  ).map((line) => line.split(/\s+/)[1]));
}

async function downloadTor() {
  try {
    return { content: await download(URLS.tor), source: URLS.tor };
  } catch (primaryError) {
    try {
      return { content: await download(URLS.torOnionoo), source: URLS.torOnionoo };
    } catch (fallbackError) {
      throw new Error(`Tor sources failed: ${primaryError.message}; ${fallbackError.message}`);
    }
  }
}

async function atomicWrite(filePath, content) {
  const token = `${process.pid}-${randomUUID()}`;
  const temporaryPath = `${filePath}.tmp-${token}`;
  const backupPath = `${filePath}.backup-${token}`;
  let hasBackup = false;
  let installed = false;
  await fs.writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 });
  try {
    try {
      await fs.rename(filePath, backupPath);
      hasBackup = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.rename(temporaryPath, filePath);
    installed = true;
    await fs.rm(backupPath, { force: true });
  } catch (error) {
    if (installed) await fs.rm(filePath, { force: true });
    if (hasBackup) await fs.rename(backupPath, filePath);
    throw error;
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

const config = loadConfig();
await fs.mkdir(config.dataDir, { recursive: true });
const [awsText, gcpText, cloudflare4, cloudflare6] = await Promise.all([
  download(URLS.aws),
  download(URLS.gcp),
  download(URLS.cloudflare4),
  download(URLS.cloudflare6),
]);
let torDownload = null;
let torError = null;
try {
  torDownload = await downloadTor();
} catch (error) {
  torError = error.message;
}
const aws = JSON.parse(awsText);
const gcp = JSON.parse(gcpText);
const generatedAt = new Date().toISOString();
const ranges = [
  ...awsRanges(aws),
  ...gcpRanges(gcp),
  ...cloudflareRanges(cloudflare4),
  ...cloudflareRanges(cloudflare6),
];
const uniqueRanges = [...new Map(ranges.map(
  (range) => [`${range.cidr}|${range.provider}|${range.service}`, range],
)).values()];
const tor = torDownload ? torAddresses(torDownload.content) : [];
if (uniqueRanges.length < 100 || (torDownload && tor.length < 100)) {
  throw new Error('Downloaded intelligence data is unexpectedly small');
}

const cloudContent = `${JSON.stringify({
    version: generatedAt.slice(0, 10),
    updated_at: generatedAt,
    source_versions: { aws: aws.syncToken || null, gcp: gcp.syncToken || null },
    ranges: uniqueRanges,
  })}\n`;
const torContent = torDownload
  ? `# updated_at=${generatedAt}\n# source=${torDownload.source}\n${tor.join('\n')}\n`
  : null;
const writes = [atomicWrite(config.ipData.cloudRangesPath, cloudContent)];
if (torDownload) {
  writes.push(atomicWrite(config.ipData.torExitPath, torContent));
}
await Promise.all(writes);

process.stdout.write(`${JSON.stringify({
  updated_at: generatedAt,
  cloud_ranges: uniqueRanges.length,
  cloud_sha256: createHash('sha256').update(cloudContent).digest('hex'),
  tor_exit_addresses: torDownload ? tor.length : null,
  tor_sha256: torContent ? createHash('sha256').update(torContent).digest('hex') : null,
  tor_source: torDownload?.source || null,
  tor_status: torDownload ? 'updated' : 'unavailable_preserved',
  tor_error: torError,
})}\n`);
