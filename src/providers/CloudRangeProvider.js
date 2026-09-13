import fs from 'node:fs/promises';
import { PrefixMatcher } from '../ip/PrefixMatcher.js';

export class CloudRangeProvider {
  constructor({ matcher = null, state }) {
    this.id = 'cloud-ranges';
    this.matcher = matcher;
    this.state = state;
  }

  static async load(filePath, now = Date.now) {
    try {
      const paths = Array.isArray(filePath) ? filePath : [filePath];
      const loaded = (await Promise.all(paths.map(async (sourcePath) => {
        try {
          const [content, stats] = await Promise.all([fs.readFile(sourcePath, 'utf8'), fs.stat(sourcePath)]);
          return { payload: JSON.parse(content), stats };
        } catch (error) {
          if (error.code === 'ENOENT') return null;
          throw error;
        }
      }))).filter(Boolean);
      if (loaded.length === 0) throw Object.assign(new Error('Cloud range files are missing'), { code: 'ENOENT' });
      const matcher = new PrefixMatcher();
      let rangeCount = 0;
      for (const { payload } of loaded) {
        for (const range of payload.ranges || []) {
          if (!range || typeof range.cidr !== 'string' || typeof range.provider !== 'string') continue;
          matcher.add(range.cidr, {
            provider: range.provider,
            service: typeof range.service === 'string' ? range.service : null,
            network_type: range.network_type === 'cdn' ? 'cdn' : 'hosting',
          });
          rangeCount += 1;
        }
      }
      if (rangeCount === 0) throw new Error('Cloud range lists are empty');
      const updateTimes = loaded.map(({ payload, stats }) => {
        const parsed = Date.parse(payload.updated_at);
        return Number.isFinite(parsed) ? new Date(parsed) : stats.mtime;
      });
      const updatedAt = new Date(Math.max(...updateTimes.map((date) => date.getTime())));
      const expiresAt = new Date(updatedAt.getTime() + 48 * 60 * 60 * 1_000);
      return new CloudRangeProvider({
        matcher,
        state: {
          id: 'cloud-ranges',
          required: false,
          ready: true,
          status: now() > expiresAt.getTime() ? 'stale' : 'ready',
          version: `${loaded.length} files / ${rangeCount} ranges`,
          updated_at: updatedAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          message: null,
        },
      });
    } catch (error) {
      return new CloudRangeProvider({
        state: {
          id: 'cloud-ranges',
          required: false,
          ready: false,
          status: 'unavailable',
          version: null,
          updated_at: null,
          expires_at: null,
          message: error.code === 'ENOENT' ? 'Cloud range file is missing' : 'Cloud ranges could not be loaded',
        },
      });
    }
  }

  lookup(ip) {
    if (!this.matcher) return { available: false, matches: [] };
    try {
      return { available: true, matches: this.matcher.lookup(ip) };
    } catch {
      return { available: true, matches: [] };
    }
  }

  publicState() {
    return { ...this.state };
  }
}
