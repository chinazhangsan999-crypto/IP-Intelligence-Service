import fs from 'node:fs/promises';
import { IP2Proxy } from 'ip2proxy-nodejs';

export class Ip2ProxyProvider {
  constructor({ database = null, state }) {
    this.id = 'ip2proxy-lite';
    this.database = database;
    this.state = state;
  }

  static async load(filePath, createDatabase = () => new IP2Proxy()) {
    try {
      const stats = await fs.stat(filePath);
      const database = createDatabase();
      if (database.open(filePath) !== 0) throw new Error('IP2Proxy BIN open failed');
      return new Ip2ProxyProvider({
        database,
        state: {
          id: 'ip2proxy-lite',
          required: false,
          ready: true,
          status: 'ready',
          version: String(database.getDatabaseVersion?.() || '').slice(0, 32) || null,
          updated_at: stats.mtime.toISOString(),
          expires_at: null,
          message: null,
        },
      });
    } catch (error) {
      return new Ip2ProxyProvider({
        state: {
          id: 'ip2proxy-lite',
          required: false,
          ready: false,
          status: 'unavailable',
          version: null,
          updated_at: null,
          expires_at: null,
          message: error.code === 'ENOENT' ? 'IP2Proxy BIN file is missing' : 'IP2Proxy database could not be loaded',
        },
      });
    }
  }

  lookup(ip) {
    if (!this.database) return { available: false, record: null };
    try {
      const record = this.database.getAll(ip);
      return { available: record?.isProxy !== -1, record: record?.isProxy === -1 ? null : record };
    } catch {
      return { available: false, record: null };
    }
  }

  close() {
    if (this.database) this.database.close();
  }

  publicState() {
    return { ...this.state };
  }
}
