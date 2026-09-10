import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIpInput } from '../src/ip/ipAddress.js';

test('normalizes IPv4, IPv6 and IPv6 /64 inputs', () => {
  assert.deepEqual(parseIpInput('1.1.1.1'), {
    valid: true,
    input: '1.1.1.1',
    ip: '1.1.1.1',
    queryAddress: '1.1.1.1',
    ipVersion: 4,
    scope: 'public',
  });

  const ipv6 = parseIpInput('2409:8000:0000:0000:1234::1/64');
  assert.equal(ipv6.valid, true);
  assert.equal(ipv6.ip, '2409:8000::/64');
  assert.equal(ipv6.queryAddress, '2409:8000::');
  assert.equal(ipv6.ipVersion, 6);
});

test('classifies non-public scopes without accepting unsupported CIDR', () => {
  assert.equal(parseIpInput('10.0.0.1').scope, 'private');
  assert.equal(parseIpInput('127.0.0.1').scope, 'loopback');
  assert.equal(parseIpInput('169.254.1.1').scope, 'link_local');
  assert.equal(parseIpInput('224.0.0.1').scope, 'multicast');
  assert.equal(parseIpInput('2001:db8::1').scope, 'reserved');
  assert.equal(parseIpInput('10.0.0.0/8').valid, false);
  assert.equal(parseIpInput('2001:db8::/48').valid, false);
  assert.equal(parseIpInput('example.com').valid, false);
  assert.equal(parseIpInput(123).input, '123');
});
