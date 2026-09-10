import fs from 'node:fs/promises';
import ipaddr from 'ipaddr.js';

export class TorExitProvider {
  constructor({ addresses = null, state }) {
    this.id = 'tor-exit';
    this.addresses = addresses;
    this.state = state;
  }

  static async load(filePath, now = Date.now) {
    try {
      const [content, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
      const addresses = new Set();
      let version = null;
      for (const line of content.split(/\r?\n/)) {
        if (line.startsWith('# updated_at=')) version = line.slice(13).trim();
        const candidate = line.startsWith('ExitAddress ')
          ? line.split(/\s+/)[1]
          : line.trim();
        if (!candidate || candidate.startsWith('#') || !ipaddr.isValid(candidate)) continue;
        addresses.add(ipaddr.parse(candidate).toString());
      }
      if (addresses.size === 0) throw new Error('Tor exit list is empty');
      const parsedUpdatedAt = Date.parse(version);
      const updatedAt = Number.isFinite(parsedUpdatedAt) ? new Date(parsedUpdatedAt) : stats.mtime;
      const expiresAt = new Date(updatedAt.getTime() + 24 * 60 * 60 * 1_000);
      return new TorExitProvider({
        addresses,
        state: {
          id: 'tor-exit',
          required: false,
          ready: true,
          status: now() > expiresAt.getTime() ? 'stale' : 'ready',
          version: version ? version.slice(0, 32) : null,
          updated_at: updatedAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          message: null,
        },
      });
    } catch (error) {
      return new TorExitProvider({
        state: {
          id: 'tor-exit',
          required: false,
          ready: false,
          status: 'unavailable',
          version: null,
          updated_at: null,
          expires_at: null,
          message: error.code === 'ENOENT' ? 'Tor exit list is missing' : 'Tor exit list could not be loaded',
        },
      });
    }
  }

  lookup(ip) {
    if (!this.addresses) return { available: false, matched: false };
    try {
      return { available: true, matched: this.addresses.has(ipaddr.parse(ip).toString()) };
    } catch {
      return { available: true, matched: false };
    }
  }

  publicState() {
    return { ...this.state };
  }
}
