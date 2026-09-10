export class ClientRateLimiter {
  constructor({ now = Date.now, maxEntries = 100_000 } = {}) {
    this.now = now;
    this.maxEntries = maxEntries;
    this.windows = new Map();
  }

  consume(clientId, limit) {
    const nowMs = this.now();
    const windowStart = Math.floor(nowMs / 60_000) * 60_000;
    const current = this.windows.get(clientId);
    const state = !current || current.windowStart !== windowStart
      ? { windowStart, count: 0 }
      : current;

    if (!current && this.windows.size >= this.maxEntries) {
      const oldestKey = this.windows.keys().next().value;
      if (oldestKey !== undefined) this.windows.delete(oldestKey);
    }

    if (state.count >= limit) {
      const resetAfterSeconds = Math.max(1, Math.ceil((windowStart + 60_000 - nowMs) / 1_000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds: resetAfterSeconds,
        resetAfterSeconds,
      };
    }

    state.count += 1;
    this.windows.set(clientId, state);
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - state.count),
      resetAfterSeconds: Math.max(1, Math.ceil((windowStart + 60_000 - nowMs) / 1_000)),
    };
  }
}
