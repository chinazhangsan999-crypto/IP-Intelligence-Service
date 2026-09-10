export class ReplayGuard {
  constructor({ ttlSeconds, maxEntries, now = Date.now }) {
    this.ttlMs = ttlSeconds * 1_000;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  consume(clientId, nonce) {
    const nowMs = this.now();
    const key = `${clientId}:${nonce}`;
    const existingExpiry = this.entries.get(key);

    if (existingExpiry && existingExpiry > nowMs) return false;
    if (existingExpiry) this.entries.delete(key);

    if (this.entries.size >= this.maxEntries) {
      for (const [entryKey, expiry] of this.entries) {
        if (expiry <= nowMs) this.entries.delete(entryKey);
      }
    }

    if (this.entries.size >= this.maxEntries) {
      const error = new Error('Nonce store capacity reached');
      error.code = 'NONCE_STORE_FULL';
      throw error;
    }

    this.entries.set(key, nowMs + this.ttlMs);
    return true;
  }
}
