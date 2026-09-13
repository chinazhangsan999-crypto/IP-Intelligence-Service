import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import yauzl from 'yauzl';
import { IP2Proxy } from 'ip2proxy-nodejs';
import { loadConfig } from '../src/config.js';

const MAX_COMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1_000;
const BIN_FILE_NAME = /^IP2PROXY-LITE(?:-PX\d+)?\.BIN$/i;
const forceUpdate = process.argv.includes('--force');

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
          reject(new Error('IP2Proxy download exceeded redirect limit'));
          return;
        }
        downloadOnce(new URL(response.headers.location, url), targetPath, redirectsLeft - 1)
          .then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`IP2Proxy download failed with HTTP ${response.statusCode}`));
        return;
      }
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_COMPRESSED_BYTES) {
        response.destroy();
        reject(new Error('IP2Proxy download is larger than allowed'));
        return;
      }
      pipeline(
        response,
        byteLimiter(MAX_COMPRESSED_BYTES, 'IP2Proxy download'),
        fs.createWriteStream(targetPath, { mode: 0o600 }),
      ).then(resolve, reject);
    });
    request.setTimeout(180_000, () => request.destroy(new Error('IP2Proxy download timed out')));
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
  throw new Error(`IP2Proxy database download failed: ${String(lastError?.message || 'unknown error').slice(0, 240)}`);
}

async function rejectErrorPage(filePath) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8').toUpperCase();
    if (text.includes('NO PERMISSION')) throw new Error('IP2Proxy download was not authorized');
    if (text.includes('QUOTA') || text.includes('5 TIMES')) throw new Error('IP2Proxy download quota was exceeded');
    if (text.includes('<HTML') || text.includes('<!DOCTYPE')) throw new Error('IP2Proxy download returned an unexpected response');
  } finally {
    await handle.close();
  }
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => {
      if (error) {
        reject(new Error('IP2Proxy download is not a valid ZIP archive'));
        return;
      }
      let settled = false;
      let entryCount = 0;
      let binEntry = null;
      const fail = (reason) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(reason);
      };
      zip.on('error', () => fail(new Error('IP2Proxy ZIP archive could not be read')));
      zip.on('entry', (entry) => {
        entryCount += 1;
        if (entryCount > MAX_ZIP_ENTRIES) {
          fail(new Error('IP2Proxy ZIP archive has too many entries'));
          return;
        }
        const fileName = path.posix.basename(entry.fileName);
        if (BIN_FILE_NAME.test(fileName)) {
          if (binEntry || entry.uncompressedSize > MAX_UNCOMPRESSED_BYTES) {
            fail(new Error('IP2Proxy ZIP archive has an invalid BIN entry'));
            return;
          }
          binEntry = entry;
        }
        zip.readEntry();
      });
      zip.on('end', () => {
        if (settled) return;
        if (!binEntry) {
          fail(new Error('IP2Proxy ZIP archive does not contain a LITE BIN file'));
          return;
        }
        settled = true;
        resolve({ zip, entry: binEntry });
      });
      zip.readEntry();
    });
  });
}

async function extractBin(zipPath, targetPath) {
  const { zip, entry } = await openZip(zipPath);
  try {
    const source = await new Promise((resolve, reject) => {
      zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)));
    });
    await pipeline(
      source,
      byteLimiter(MAX_UNCOMPRESSED_BYTES, 'IP2Proxy database'),
      fs.createWriteStream(targetPath, { mode: 0o600 }),
    );
  } catch {
    throw new Error('IP2Proxy BIN extraction failed');
  } finally {
    zip.close();
  }
}

async function validateBin(filePath) {
  const stats = await fsp.stat(filePath);
  if (stats.size < 1024 * 1024 || stats.size > MAX_UNCOMPRESSED_BYTES) {
    throw new Error('IP2Proxy BIN file size is invalid');
  }
  const database = new IP2Proxy();
  try {
    if (database.open(filePath) !== 0) throw new Error('IP2Proxy BIN could not be opened');
    const version = String(database.getDatabaseVersion?.() || '').slice(0, 64) || null;
    if (!version) throw new Error('IP2Proxy BIN does not report a version');
    return { version, size: stats.size, sha256: await fileSha256(filePath) };
  } finally {
    database.close();
  }
}

async function fileSha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function readState(statePath) {
  try {
    const value = JSON.parse(await fsp.readFile(statePath, 'utf8'));
    const checkedAt = Date.parse(value.last_checked_at);
    return Number.isFinite(checkedAt) ? checkedAt : null;
  } catch {
    return null;
  }
}

async function writeState(statePath, data) {
  const temporaryPath = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
  await fsp.writeFile(temporaryPath, `${JSON.stringify(data)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fsp.rename(temporaryPath, statePath);
}

async function installBin(newPath, targetPath, backupPath) {
  let hasBackup = false;
  let installed = false;
  try {
    try {
      await fsp.rename(targetPath, backupPath);
      hasBackup = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fsp.rename(newPath, targetPath);
    installed = true;
    await fsp.rm(backupPath, { force: true });
  } catch (error) {
    if (installed) await fsp.rm(targetPath, { force: true });
    if (hasBackup) await fsp.rename(backupPath, targetPath);
    throw error;
  }
}

const config = loadConfig();
const { ipData } = config;
if (!ipData.ip2ProxyAutoUpdateEnabled) {
  process.stdout.write(`${JSON.stringify({ status: 'disabled', updated: false })}\n`);
} else {
  if (!ipData.ip2ProxyDownloadToken || !ipData.ip2ProxyDownloadCode) {
    throw new Error('IP2Proxy download credentials are not configured');
  }
  await fsp.mkdir(config.dataDir, { recursive: true });

  const statePath = path.join(config.dataDir, 'ip2proxy-update-state.json');
  const current = await validateBin(ipData.ip2ProxyPath).catch(() => null);
  const lastCheckedAt = await readState(statePath);
  if (!forceUpdate && current && lastCheckedAt && Date.now() - lastCheckedAt < ipData.ip2ProxyUpdateIntervalMs) {
    process.stdout.write(`${JSON.stringify({
      status: 'not_due', updated: false, version: current.version, next_check_at: new Date(lastCheckedAt + ipData.ip2ProxyUpdateIntervalMs).toISOString(),
    })}\n`);
  } else {
    const token = `${process.pid}-${randomUUID()}`;
    const zipPath = path.join(config.dataDir, `.ip2proxy-${token}.zip`);
    const newPath = path.join(config.dataDir, `.ip2proxy-${token}.BIN`);
    const backupPath = path.join(config.dataDir, `.ip2proxy-${token}.backup.BIN`);
    const downloadUrl = new URL('https://www.ip2location.com/download');
    downloadUrl.searchParams.set('token', ipData.ip2ProxyDownloadToken);
    downloadUrl.searchParams.set('file', ipData.ip2ProxyDownloadCode);
    try {
      await download(downloadUrl, zipPath);
      await rejectErrorPage(zipPath);
      await extractBin(zipPath, newPath);
      const next = await validateBin(newPath);
      if (current?.sha256 === next.sha256) {
        await writeState(statePath, { last_checked_at: new Date().toISOString(), version: next.version });
        process.stdout.write(`${JSON.stringify({ status: 'current', updated: false, version: next.version, sha256: next.sha256, size: next.size })}\n`);
      } else {
        await installBin(newPath, ipData.ip2ProxyPath, backupPath);
        await writeState(statePath, { last_checked_at: new Date().toISOString(), version: next.version });
        process.stdout.write(`${JSON.stringify({ status: 'updated', updated: true, version: next.version, sha256: next.sha256, size: next.size })}\n`);
      }
    } finally {
      await Promise.all([zipPath, newPath].map((filePath) => fsp.rm(filePath, { force: true })));
    }
  }
}
