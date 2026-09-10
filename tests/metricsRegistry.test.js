import assert from 'node:assert/strict';
import test from 'node:test';
import { MetricsRegistry } from '../src/observability/MetricsRegistry.js';
import { createReadiness } from '../src/readiness.js';

test('metrics registry exposes bounded aggregate metrics without request data', () => {
  let now = 1_000_000;
  const metrics = new MetricsRegistry({ now: () => now });
  metrics.observeHttp({
    method: 'POST', route: '/v1/ip/lookup', statusCode: 200, durationMs: 12, slow: false,
  });
  metrics.observeLookup({
    requested_count: 3,
    unique_count: 2,
    resolved_count: 1,
    invalid_count: 1,
    unavailable_count: 0,
  });
  metrics.observeDataUpdate('succeeded');
  now += 5_000;

  const readiness = createReadiness([
    { id: 'dbip-city', required: true, ready: true, status: 'ready' },
  ]);
  const snapshot = metrics.snapshot({ readiness });
  assert.equal(snapshot.uptime_seconds, 5);
  assert.equal(snapshot.requests.total, 1);
  assert.equal(snapshot.lookups.ips.requested, 3);
  assert.equal(snapshot.requests.by_route[0].route, '/v1/ip/lookup');
  assert.equal(snapshot.requests.by_route[0].average_ms, 12);

  const output = metrics.renderPrometheus({
    serviceName: 'ip-intelligence-service',
    readiness,
    updateScheduler: { snapshot: () => ({ running: false, last_run: null }) },
    pool: { totalCount: 2, idleCount: 1, waitingCount: 0 },
  });
  assert.match(output, /ip_intelligence_http_requests_total\{method="POST",route="\/v1\/ip\/lookup",status="200"\} 1/);
  assert.match(output, /ip_intelligence_lookup_ips_total\{status="resolved"\} 1/);
  assert.match(output, /ip_intelligence_data_source_ready\{source="dbip-city",required="true"\} 1/);
  assert.doesNotMatch(output, /1\.1\.1\.1|client_id|nonce/i);
});
