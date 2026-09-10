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
      const [content, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      const payload = JSON.parse(content);
      if (!Array.isArray(payload.ranges) || payload.ranges.length === 0) {
        throw new Error('Cloud range list is empty');
      }
      const matcher = new PrefixMatcher();
      for (const range of payload.ranges) {
        if (!range || typeof range.cidr !== 'string' || typeof range.provider !== 'string') continue;
        matcher.add(range.cidr, {
          provider: range.provider,
          service: typeof range.service === 'string' ? range.service : null,
          network_type: range.network_type === 'cdn' ? 'cdn' : 'hosting',
        });
      }
      const parsedUpdatedAt = Date.parse(payload.updated_at);
      const updatedAt = Number.isFinite(parsedUpdatedAt) ? new Date(parsedUpdatedAt) : stats.mtime;
      const expiresAt = new Date(updatedAt.getTime() + 48 * 60 * 60 * 1_000);
      return new CloudRangeProvider({
        matcher,
        state: {
          id: 'cloud-ranges',
          required: false,
          ready: true,
          status: now() > expiresAt.getTime() ? 'stale' : 'ready',
          version: String(payload.version || payload.updated_at || '').slice(0, 32) || null,
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
