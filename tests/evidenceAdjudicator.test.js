import assert from 'node:assert/strict';
import test from 'node:test';
import { adjudicateEvidence } from '../src/services/EvidenceAdjudicator.js';

test('prefers a high-confidence routing result and preserves alternatives', () => {
  const result = adjudicateEvidence('asn', [
    { value: 64500, source: 'dbip-asn', confidence: 'medium' },
    { value: 64500, source: 'sapics-dbip-asn', confidence: 'medium' },
    { value: 13335, source: 'ripe-ris', confidence: 'high' },
  ]);
  assert.equal(result.value, 13335);
  assert.equal(result.status, 'resolved_by_high_confidence');
  assert.equal(result.total_independent_sources, 2);
  assert.equal(result.alternatives[0].value, 64500);
});

test('uses independent-source plurality instead of counting mirrors twice', () => {
  const result = adjudicateEvidence('asn', [
    { value: 100, source: 'dbip-asn', confidence: 'medium' },
    { value: 100, source: 'sapics-dbip-asn', confidence: 'medium' },
    { value: 200, source: 'sapics-origin-asn', confidence: 'medium' },
    { value: 200, source: 'sapics-iptoasn-asn', confidence: 'medium' },
  ]);
  assert.equal(result.value, 200);
  assert.equal(result.support_count, 2);
  assert.equal(result.status, 'resolved_by_plurality');
});

test('ties and conflicting high-confidence assertions have stable results', () => {
  const assertions = [
    { value: 200, source: 'routeviews', confidence: 'high' },
    { value: 100, source: 'ripe-ris', confidence: 'high' },
  ];
  const result = adjudicateEvidence('asn', assertions);
  assert.equal(result.value, 100);
  assert.equal(result.status, 'resolved_with_high_confidence_conflict');
  assert.equal(result.confidence, 'medium');
  assert.equal(adjudicateEvidence('asn', assertions.toReversed()).value, 100);
});
