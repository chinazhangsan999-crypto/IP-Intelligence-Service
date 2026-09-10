import assert from 'node:assert/strict';
import test from 'node:test';
import { IpJudgmentEngine } from '../src/services/IpJudgmentEngine.js';

test('returns unknown and null instead of inventing unsupported judgments', () => {
  const result = new IpJudgmentEngine().resolve();
  assert.equal(result.networkType, 'unknown');
  assert.equal(result.flags.is_proxy, null);
  assert.equal(result.flags.is_vpn, null);
  assert.equal(result.conflicts.length, 0);
});

test('higher-priority evidence wins while conflicting evidence remains visible', () => {
  const result = new IpJudgmentEngine()
    .add({ field: 'network_type', value: 'hosting', source: 'public-cloud', confidence: 'high', priority: 700 })
    .add({ field: 'network_type', value: 'business', source: 'manual-rule', confidence: 'high', priority: 1200 })
    .add({ field: 'is_hosting', value: true, source: 'public-cloud', confidence: 'high', priority: 700 })
    .add({ field: 'is_hosting', value: false, source: 'manual-rule', confidence: 'high', priority: 1200 })
    .resolve();

  assert.equal(result.networkType, 'business');
  assert.equal(result.flags.is_hosting, false);
  assert.deepEqual(result.conflicts.map((item) => item.field), ['network_type', 'is_hosting']);
});

test('equally strong contradictory evidence abstains regardless of insertion order', () => {
  const assertions = [
    { field: 'is_proxy', value: true, source: 'source-a', confidence: 'high', priority: 500 },
    { field: 'is_proxy', value: false, source: 'source-b', confidence: 'high', priority: 500 },
  ];
  const forward = new IpJudgmentEngine();
  const reverse = new IpJudgmentEngine();
  assertions.forEach((item) => forward.add(item));
  assertions.toReversed().forEach((item) => reverse.add(item));

  assert.equal(forward.resolve().flags.is_proxy, null);
  assert.equal(reverse.resolve().flags.is_proxy, null);
  assert.equal(forward.resolve().conflicts[0].field, 'is_proxy');
});

test('rejects unsupported fields and non-boolean flag assertions', () => {
  assert.throws(() => new IpJudgmentEngine().add({
    field: 'risk_score', value: 10, source: 'test', priority: 1,
  }), /Unsupported judgment field/);
  assert.throws(() => new IpJudgmentEngine().add({
    field: 'is_tor', value: 'yes', source: 'test', priority: 1,
  }), /boolean value/);
  assert.throws(() => new IpJudgmentEngine().add({
    field: 'network_type', value: 'bot', source: 'test', priority: 1,
  }), /supported value/);
});
