import assert from 'node:assert/strict';
import test from 'node:test';
import { PrefixMatcher } from '../src/ip/PrefixMatcher.js';

test('PrefixMatcher returns IPv4 and IPv6 matches from most specific to broadest', () => {
  const matcher = new PrefixMatcher();
  matcher.add('10.0.0.0/8', 'broad');
  matcher.add('10.1.0.0/16', 'specific');
  matcher.add('2606:4700::/32', 'ipv6');

  assert.deepEqual(matcher.lookup('10.1.2.3'), ['specific', 'broad']);
  assert.deepEqual(matcher.lookup('10.2.2.3'), ['broad']);
  assert.deepEqual(matcher.lookup('2606:4700:4700::1111'), ['ipv6']);
  assert.deepEqual(matcher.lookup('1.1.1.1'), []);
});
