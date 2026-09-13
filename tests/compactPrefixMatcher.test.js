import assert from 'node:assert/strict';
import test from 'node:test';
import { CompactPrefixMatcher } from '../src/ip/CompactPrefixMatcher.js';

test('compact matcher returns IPv4 and IPv6 matches from most specific to broadest', () => {
  const matcher = new CompactPrefixMatcher();
  matcher.add('10.0.0.0/8', 'v4-broad');
  matcher.add('10.1.0.0/16', 'v4-specific');
  matcher.add('2001:db8::/32', 'v6-broad');
  matcher.add('2001:db8:1::/48', 'v6-specific');
  matcher.finalize();
  assert.deepEqual(matcher.lookup('10.1.2.3'), ['v4-specific', 'v4-broad']);
  assert.deepEqual(matcher.lookup('2001:db8:1::1'), ['v6-specific', 'v6-broad']);
  assert.deepEqual(matcher.lookup('8.8.8.8'), []);
});

test('compact matcher retains multiple assertions on the same prefix', () => {
  const matcher = new CompactPrefixMatcher();
  matcher.add('1.1.1.0/24', 'left');
  matcher.add('1.1.1.0/24', 'right');
  assert.deepEqual(matcher.lookup('1.1.1.1'), ['left', 'right']);
});

