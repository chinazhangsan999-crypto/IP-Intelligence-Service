import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import maxmind from 'maxmind';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { loadConfig } from '../src/config.js';

const MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

function versionFor(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function downloadUrl(kind, version) {
  return `https://download.db-ip.com/free/dbip-${kind}-lite-${version}.mmdb.gz`;
}

function byteLimiter(maxBytes, label) {
  let total = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      total += chunk.length;
      callback(total > maxBytes ? new Error(`${label} is larger than allowed`) : null, chunk);
    },
  });
}

function downloadOnce(url, targetPath, redirectsLeft = 3) {
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
        downloadOnce(new URL(response.headers.location, url), targetPath, redirectsLeft - 1)
          .then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}: ${url}`));
        return;
      }
      pipeline(
        response,
        byteLimiter(MAX_COMPRESSED_BYTES, 'DB-IP download'),
        fs.createWriteStream(targetPath, { mode: 0o600 }),
      ).then(resolve, reject);
    });
    request.setTimeout(180_000, () => request.destroy(new Error(`Download timed out: ${url}`)));
    request.on('error', reject);
  });
}

async function download(url, targetPath) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await fsp.rm(targetPath, { force: true });
      await downloadOnce(url, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`Unable to update ${url}: ${lastError.message}`);
}

async function databaseVersion(filePath) {
  try {
    const reader = await maxmind.open(filePath);
    const buildEpoch = reader.metadata?.buildEpoch;
    return buildEpoch instanceof Date ? buildEpoch.toISOString().slice(0, 7) : null;
  } catch {
    return null;
  }
}

async function validateDatabase(filePath, expectedType, targetVersion) {
  const reader = await maxmind.open(filePath);
  const databaseType = String(reader.metadata?.databaseType || '');
  const buildEpoch = reader.metadata?.buildEpoch;
  const version = buildEpoch instanceof Date ? buildEpoch.toISOString().slice(0, 7) : null;
  if (!databaseType.includes(expectedType) || version !== targetVersion || !reader.get('8.8.8.8')) {
    throw new Error(`Downloaded ${expectedType} database failed validation`);
  }
  return version;
}

async function fileSha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function installPair(items) {
  const installed = [];
  try {
    for (const item of items) {
      try {
        await fsp.rename(item.targetPath, item.backupPath);
        item.hasBackup = true;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fsp.rename(item.newPath, item.targetPath);
      installed.push(item);
    }
    await Promise.all(items.map((item) => fsp.rm(item.backupPath, { force: true })));
  } catch (error) {
    for (const item of installed.toReversed()) await fsp.rm(item.targetPath, { force: true });
    const rollbackErrors = [];
    for (const item of items.toReversed()) {
      if (item.hasBackup) {
        await fsp.rename(item.backupPath, item.targetPath).catch((rollbackError) => {
          rollbackErrors.push(rollbackError);
        });
      }
    }
    if (rollbackErrors.length > 0) throw new AggregateError([error, ...rollbackErrors], 'DB-IP rollback failed');
    throw error;
  }
}

const config = loadConfig();
const targetVersion = versionFor();
await fsp.mkdir(config.dataDir, { recursive: true });
const currentVersions = await Promise.all([
  databaseVersion(config.ipData.cityPath),
  databaseVersion(config.ipData.asnPath),
]);

if (currentVersions.every((version) => version === targetVersion)) {
  process.stdout.write(`${JSON.stringify({ status: 'current', version: targetVersion, updated: false })}\n`);
} else {
  const token = `${process.pid}-${randomUUID()}`;
  const items = [
    { kind: 'city', expectedType: 'DBIP-City-Lite', targetPath: config.ipData.cityPath },
    { kind: 'asn', expectedType: 'DBIP-ASN-Lite', targetPath: config.ipData.asnPath },
  ].map((item) => ({
    ...item,
    gzipPath: path.join(config.dataDir, `.${item.kind}-${token}.mmdb.gz`),
    newPath: path.join(config.dataDir, `.${item.kind}-${token}.mmdb`),
    backupPath: path.join(config.dataDir, `.${item.kind}-${token}.backup.mmdb`),
  }));

  try {
    await Promise.all(items.map(async (item) => {
      await download(downloadUrl(item.kind, targetVersion), item.gzipPath);
      await pipeline(
        fs.createReadStream(item.gzipPath),
        createGunzip(),
        byteLimiter(MAX_UNCOMPRESSED_BYTES, 'DB-IP database'),
        fs.createWriteStream(item.newPath, { mode: 0o600 }),
      );
      item.version = await validateDatabase(item.newPath, item.expectedType, targetVersion);
      item.sha256 = await fileSha256(item.newPath);
      item.size = (await fsp.stat(item.newPath)).size;
    }));
    await installPair(items);
    process.stdout.write(`${JSON.stringify({
      status: 'updated',
      version: targetVersion,
      updated: true,
      sources: items.map(({ kind, version, sha256, size }) => ({ kind, version, sha256, size })),
    })}\n`);
  } finally {
    await Promise.all(items.flatMap((item) => [item.gzipPath, item.newPath]).map(
      (filePath) => fsp.rm(filePath, { force: true }),
    ));
  }
}
