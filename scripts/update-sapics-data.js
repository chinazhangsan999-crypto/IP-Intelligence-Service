import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import maxmind from 'maxmind';
import { loadConfig } from '../src/config.js';
import { SAPICS_REFERENCE_REPOSITORY } from '../src/data/sapicsCatalog.js';

const MAX_DOWNLOAD_BYTES = 768 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;

function beijingDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).reduce((value, part) => ({ ...value, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function request(url, { binary = false, redirectsLeft = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') return reject(new Error('Only HTTPS data sources are allowed'));
    const req = https.get(target, {
      headers: {
        'user-agent': 'ip-intelligence-service-data-updater/1.0',
        accept: binary ? 'application/octet-stream' : 'application/json,text/plain;q=0.9,*/*;q=0.1',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects: ${url}`));
        return resolve(request(new URL(res.headers.location, target), { binary, redirectsLeft: redirectsLeft - 1 }));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed with HTTP ${res.statusCode}: ${target.hostname}`));
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
        res.destroy();
        return reject(new Error('Download is larger than allowed'));
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD_BYTES) res.destroy(new Error('Download is larger than allowed'));
        else chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Download timed out')));
    req.on('error', reject);
  });
}

function downloadFile(url, targetPath, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:') return reject(new Error('Only HTTPS data sources are allowed'));
    const req = https.get(target, { headers: { 'user-agent': 'ip-intelligence-service-data-updater/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) return reject(new Error(`Too many redirects: ${url}`));
        return resolve(downloadFile(new URL(res.headers.location, target), targetPath, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed with HTTP ${res.statusCode}: ${target.hostname}`));
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) {
        res.destroy();
        return reject(new Error('Download is larger than allowed'));
      }
      let bytes = 0;
      const output = fs.createWriteStream(targetPath, { mode: 0o600 });
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD_BYTES) res.destroy(new Error('Download is larger than allowed'));
      });
      res.pipe(output);
      output.on('finish', () => output.close(() => resolve(bytes)));
      output.on('error', reject);
      res.on('error', reject);
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Download timed out')));
    req.on('error', reject);
  });
}

async function json(url) {
  return JSON.parse((await request(url)).toString('utf8'));
}

function checksum(text) {
  const value = String(text).match(/\b[a-f0-9]{64}\b/i)?.[0];
  if (!value) throw new Error('Checksum response does not contain a SHA-256 value');
  return value.toLowerCase();
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function validRecord(dataset, record) {
  if (!record) return false;
  if (dataset.kind === 'asn') return Number.isFinite(Number(record.autonomous_system_number ?? record.asn));
  if (dataset.kind === 'country') return Boolean(record.country?.iso_code || record.country_code || record.country);
  return typeof record === 'object' && Object.keys(record).length > 0;
}

async function validate(dataset, filePath) {
  const reader = await maxmind.open(filePath);
  const record = reader.get('8.8.8.8') || reader.get('1.1.1.1');
  if (!validRecord(dataset, record)) throw new Error(`MMDB validation failed for ${dataset.id}`);
  return reader.metadata?.buildEpoch instanceof Date ? reader.metadata.buildEpoch.toISOString() : null;
}

async function install(dataset, temporaryPath, targetPath) {
  const rollbackDirectory = path.join(path.dirname(targetPath), 'rollback');
  const rollbackPath = path.join(rollbackDirectory, `${dataset.id}.mmdb`);
  await fsp.mkdir(rollbackDirectory, { recursive: true });
  const token = `${process.pid}-${randomUUID()}`;
  const oldPath = `${rollbackPath}.${token}`;
  let oldRollbackExists = false;
  let installed = false;
  try {
    try {
      await fsp.rename(rollbackPath, oldPath);
      oldRollbackExists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await fsp.rename(targetPath, rollbackPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fsp.rename(temporaryPath, targetPath);
    installed = true;
    if (oldRollbackExists) await fsp.rm(oldPath, { force: true });
  } catch (error) {
    if (installed) await fsp.rename(targetPath, temporaryPath).catch(() => {});
    await fsp.rename(rollbackPath, targetPath).catch(() => {});
    if (oldRollbackExists) await fsp.rename(oldPath, rollbackPath).catch(() => {});
    throw error;
  }
}

const config = loadConfig();
const statePath = path.join(config.dataDir, 'sapics-update-state.json');
await fsp.mkdir(config.dataDir, { recursive: true });
const now = beijingDateParts();
let previous = {};
try { previous = JSON.parse(await fsp.readFile(statePath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }

if (previous.last_success_bjt === now.date) {
  process.stdout.write(`${JSON.stringify({ status: 'current', updated: false, reason: 'already_updated_today', reference_commit: previous.reference_commit || null })}\n`);
} else if (now.hour < config.ipData.sapicsUpdateHourBjt) {
  process.stdout.write(`${JSON.stringify({ status: 'deferred', updated: false, reason: 'waiting_for_daily_source_window' })}\n`);
} else {
  const reference = await json(`https://api.github.com/repos/${SAPICS_REFERENCE_REPOSITORY}/commits/main`);
  const referenceCommit = String(reference.sha || 'unknown');
  const sources = [];
  for (const dataset of config.ipData.sapicsDatasets) {
    const token = `${process.pid}-${randomUUID()}`;
    const temporaryPath = path.join(config.dataDir, `.${dataset.id}-${token}.mmdb`);
    try {
      const [bytes, checksumResponse] = await Promise.all([
        downloadFile(dataset.downloadUrl, temporaryPath),
        request(dataset.checksumUrl),
      ]);
      const expectedSha256 = checksum(checksumResponse.toString('utf8'));
      const actualSha256 = await sha256(temporaryPath);
      if (actualSha256 !== expectedSha256) throw new Error('SHA-256 verification failed');
      const buildEpoch = await validate(dataset, temporaryPath);
      await install(dataset, temporaryPath, dataset.filePath);
      sources.push({ id: dataset.id, status: 'updated', version: buildEpoch, sha256: actualSha256, bytes, license: dataset.license });
    } catch (error) {
      sources.push({ id: dataset.id, status: 'failed', error: String(error.message || error).slice(0, 500), license: dataset.license });
    } finally {
      await fsp.rm(temporaryPath, { force: true });
    }
  }
  const successful = sources.filter((source) => source.status === 'updated');
  const complete = successful.length === sources.length;
  const nextState = {
    ...previous,
    last_checked_bjt: now.date,
    ...(complete ? { last_success_bjt: now.date } : {}),
    reference_commit: referenceCommit,
    updated_at: new Date().toISOString(),
    sources,
  };
  await fsp.writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    status: complete ? 'updated' : successful.length > 0 ? 'partial' : 'failed',
    updated: successful.length > 0,
    reference_commit: referenceCommit,
    sources,
  })}\n`);
}
