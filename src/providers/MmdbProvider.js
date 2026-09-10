import fs from 'node:fs/promises';
import maxmind from 'maxmind';

function formatVersion(buildEpoch) {
  if (!(buildEpoch instanceof Date) || Number.isNaN(buildEpoch.getTime())) return null;
  return buildEpoch.toISOString().slice(0, 7);
}

function freshness(buildEpoch, now) {
  if (!(buildEpoch instanceof Date) || Number.isNaN(buildEpoch.getTime())) {
    return { status: 'ready', updatedAt: null, expiresAt: null };
  }
  const expiresAt = new Date(buildEpoch.getTime() + 45 * 24 * 60 * 60 * 1_000);
  return {
    status: now() > expiresAt.getTime() ? 'stale' : 'ready',
    updatedAt: buildEpoch.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export class MmdbProvider {
  constructor({ id, required, filePath, reader = null, state }) {
    this.id = id;
    this.required = required;
    this.filePath = filePath;
    this.reader = reader;
    this.state = state;
  }

  static async load({ id, required = true, filePath, cacheSize = 10_000, openDatabase = maxmind.open, now = Date.now }) {
    try {
      const [reader, stats] = await Promise.all([
        openDatabase(filePath, { cache: { max: cacheSize } }),
        fs.stat(filePath),
      ]);
      const buildEpoch = reader.metadata?.buildEpoch || null;
      const sourceFreshness = freshness(buildEpoch, now);
      return new MmdbProvider({
        id,
        required,
        filePath,
        reader,
        state: {
          id,
          required,
          ready: true,
          status: sourceFreshness.status,
          version: formatVersion(buildEpoch),
          updated_at: sourceFreshness.updatedAt || stats.mtime.toISOString(),
          expires_at: sourceFreshness.expiresAt,
          message: null,
        },
      });
    } catch (error) {
      return new MmdbProvider({
        id,
        required,
        filePath,
        state: {
          id,
          required,
          ready: false,
          status: 'unavailable',
          version: null,
          updated_at: null,
          expires_at: null,
          message: error.code === 'ENOENT' ? 'Database file is missing' : 'Database could not be loaded',
        },
      });
    }
  }

  lookup(ip) {
    if (!this.reader) return { available: false, record: null };
    try {
      return { available: true, record: this.reader.get(ip) || null };
    } catch {
      return { available: false, record: null };
    }
  }

  publicState() {
    return { ...this.state };
  }
}
