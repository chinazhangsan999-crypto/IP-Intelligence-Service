const DURATION_BUCKETS_SECONDS = Object.freeze([
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
]);

function increment(map, key, value = 1) {
  map.set(key, (map.get(key) || 0) + value);
}

function labelsKey(values) {
  return values.join('\u0000');
}

function escapeLabel(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function labels(names, values) {
  return `{${names.map((name, index) => `${name}="${escapeLabel(values[index])}"`).join(',')}}`;
}

function durationPercentile(duration, percentile) {
  if (!duration || duration.count === 0) return null;
  const target = duration.count * percentile;
  const index = duration.buckets.findIndex((count) => count >= target);
  return index === -1 ? null : DURATION_BUCKETS_SECONDS[index] * 1_000;
}

export class MetricsRegistry {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.startedAt = now();
    this.httpRequests = new Map();
    this.httpDurations = new Map();
    this.lookupBatches = 0;
    this.lookupIps = new Map();
    this.updateRuns = new Map();
    this.slowRequests = 0;
  }

  observeHttp({ method, route, statusCode, durationMs, slow = false }) {
    const values = [method, route, String(statusCode)];
    increment(this.httpRequests, labelsKey(values));
    const durationKey = labelsKey([method, route]);
    const duration = this.httpDurations.get(durationKey) || {
      count: 0,
      sum: 0,
      buckets: DURATION_BUCKETS_SECONDS.map(() => 0),
    };
    const durationSeconds = durationMs / 1_000;
    duration.count += 1;
    duration.sum += durationSeconds;
    DURATION_BUCKETS_SECONDS.forEach((limit, index) => {
      if (durationSeconds <= limit) duration.buckets[index] += 1;
    });
    this.httpDurations.set(durationKey, duration);
    if (slow) this.slowRequests += 1;
  }

  observeLookup(meta) {
    this.lookupBatches += 1;
    increment(this.lookupIps, 'requested', meta.requested_count || 0);
    increment(this.lookupIps, 'unique', meta.unique_count || 0);
    increment(this.lookupIps, 'resolved', meta.resolved_count || 0);
    increment(this.lookupIps, 'invalid', meta.invalid_count || 0);
    increment(this.lookupIps, 'unavailable', meta.unavailable_count || 0);
  }

  observeDataUpdate(status) {
    increment(this.updateRuns, status);
  }

  snapshot({ readiness, updateScheduler = null, pool = null } = {}) {
    const memory = process.memoryUsage();
    const requestTotal = [...this.httpRequests.values()].reduce((sum, value) => sum + value, 0);
    const byStatusClass = {};
    for (const [key, value] of this.httpRequests) {
      const statusCode = key.split('\u0000')[2];
      const statusClass = /^\d{3}$/.test(statusCode) ? `${statusCode[0]}xx` : 'other';
      byStatusClass[statusClass] = (byStatusClass[statusClass] || 0) + value;
    }
    const byRoute = [...this.httpDurations.entries()].map(([key, duration]) => {
      const [method, route] = key.split('\u0000');
      return {
        method,
        route,
        requests: duration.count,
        average_ms: Number(((duration.sum / duration.count) * 1_000).toFixed(2)),
        p95_ms: durationPercentile(duration, 0.95),
      };
    }).sort((left, right) => right.requests - left.requests);
    return {
      started_at: new Date(this.startedAt).toISOString(),
      uptime_seconds: Math.max(0, Math.floor((this.now() - this.startedAt) / 1_000)),
      requests: {
        total: requestTotal,
        slow: this.slowRequests,
        by_status_class: byStatusClass,
        by_route: byRoute,
      },
      lookups: {
        batches: this.lookupBatches,
        ips: Object.fromEntries(this.lookupIps),
      },
      updates: {
        runs: Object.fromEntries(this.updateRuns),
        scheduler: updateScheduler?.snapshot?.() || null,
      },
      process: {
        resident_memory_bytes: memory.rss,
        heap_used_bytes: memory.heapUsed,
        heap_total_bytes: memory.heapTotal,
      },
      postgres: pool ? {
        total_connections: pool.totalCount,
        idle_connections: pool.idleCount,
        waiting_requests: pool.waitingCount,
      } : null,
      readiness: readiness?.snapshot?.() || null,
    };
  }

  renderPrometheus({ serviceName, readiness, updateScheduler = null, pool = null }) {
    const lines = [
      '# HELP ip_intelligence_info Static service information.',
      '# TYPE ip_intelligence_info gauge',
      `ip_intelligence_info${labels(['service'], [serviceName])} 1`,
      '# HELP ip_intelligence_process_uptime_seconds Process uptime.',
      '# TYPE ip_intelligence_process_uptime_seconds gauge',
      `ip_intelligence_process_uptime_seconds ${Math.max(0, (this.now() - this.startedAt) / 1_000)}`,
    ];

    const memory = process.memoryUsage();
    for (const [name, value] of Object.entries({
      resident_memory_bytes: memory.rss,
      heap_used_bytes: memory.heapUsed,
      heap_total_bytes: memory.heapTotal,
    })) {
      lines.push(`# TYPE ip_intelligence_process_${name} gauge`);
      lines.push(`ip_intelligence_process_${name} ${value}`);
    }

    lines.push('# HELP ip_intelligence_http_requests_total Completed HTTP requests.');
    lines.push('# TYPE ip_intelligence_http_requests_total counter');
    for (const [key, value] of this.httpRequests) {
      const values = key.split('\u0000');
      lines.push(`ip_intelligence_http_requests_total${labels(['method', 'route', 'status'], values)} ${value}`);
    }

    lines.push('# HELP ip_intelligence_http_request_duration_seconds Request duration histogram.');
    lines.push('# TYPE ip_intelligence_http_request_duration_seconds histogram');
    for (const [key, value] of this.httpDurations) {
      const values = key.split('\u0000');
      DURATION_BUCKETS_SECONDS.forEach((limit, index) => {
        lines.push(`ip_intelligence_http_request_duration_seconds_bucket${labels(['method', 'route', 'le'], [...values, limit])} ${value.buckets[index]}`);
      });
      lines.push(`ip_intelligence_http_request_duration_seconds_bucket${labels(['method', 'route', 'le'], [...values, '+Inf'])} ${value.count}`);
      lines.push(`ip_intelligence_http_request_duration_seconds_sum${labels(['method', 'route'], values)} ${value.sum}`);
      lines.push(`ip_intelligence_http_request_duration_seconds_count${labels(['method', 'route'], values)} ${value.count}`);
    }

    lines.push('# TYPE ip_intelligence_slow_requests_total counter');
    lines.push(`ip_intelligence_slow_requests_total ${this.slowRequests}`);
    lines.push('# TYPE ip_intelligence_lookup_batches_total counter');
    lines.push(`ip_intelligence_lookup_batches_total ${this.lookupBatches}`);
    lines.push('# TYPE ip_intelligence_lookup_ips_total counter');
    for (const [status, value] of this.lookupIps) {
      lines.push(`ip_intelligence_lookup_ips_total${labels(['status'], [status])} ${value}`);
    }
    lines.push('# TYPE ip_intelligence_data_update_runs_total counter');
    for (const [status, value] of this.updateRuns) {
      lines.push(`ip_intelligence_data_update_runs_total${labels(['status'], [status])} ${value}`);
    }

    for (const source of readiness.snapshot().sources) {
      lines.push(`ip_intelligence_data_source_ready${labels(['source', 'required'], [source.id, source.required])} ${source.ready ? 1 : 0}`);
      lines.push(`ip_intelligence_data_source_stale${labels(['source'], [source.id])} ${source.status === 'stale' ? 1 : 0}`);
    }

    const updateState = updateScheduler?.snapshot?.();
    lines.push(`ip_intelligence_data_update_running ${updateState?.running ? 1 : 0}`);
    lines.push(`ip_intelligence_data_update_last_success ${updateState?.last_run?.status === 'succeeded' ? 1 : 0}`);
    if (updateState?.last_run?.completed_at) {
      lines.push(`ip_intelligence_data_update_last_run_timestamp_seconds ${Date.parse(updateState.last_run.completed_at) / 1_000}`);
    }

    if (pool) {
      lines.push(`ip_intelligence_postgres_connections${labels(['state'], ['total'])} ${pool.totalCount}`);
      lines.push(`ip_intelligence_postgres_connections${labels(['state'], ['idle'])} ${pool.idleCount}`);
      lines.push(`ip_intelligence_postgres_waiting_requests ${pool.waitingCount}`);
    }
    return `${lines.join('\n')}\n`;
  }
}
