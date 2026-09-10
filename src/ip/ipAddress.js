import ipaddr from 'ipaddr.js';

const SCOPE_BY_RANGE = Object.freeze({
  unicast: 'public',
  private: 'private',
  uniqueLocal: 'private',
  loopback: 'loopback',
  linkLocal: 'link_local',
  multicast: 'multicast',
  broadcast: 'reserved',
  carrierGradeNat: 'reserved',
  reserved: 'reserved',
  unspecified: 'reserved',
  benchmarking: 'reserved',
  amt: 'reserved',
  as112: 'reserved',
  deprecated: 'reserved',
  orchid2: 'reserved',
  teredo: 'reserved',
  '6to4': 'reserved',
});

function scopeFor(address) {
  if (address.kind() === 'ipv6' && address.range() === 'ipv4Mapped') {
    return scopeFor(address.toIPv4Address());
  }
  return SCOPE_BY_RANGE[address.range()] || 'unknown';
}

function normalizedIpv6Network(address) {
  const parts = [...address.parts];
  parts.fill(0, 4);
  return new ipaddr.IPv6(parts).toString();
}

export function parseIpInput(input) {
  if (typeof input !== 'string') {
    return { valid: false, input: String(input), message: 'IP must be a string' };
  }

  const value = input.trim();
  if (!value || value.length > 64) {
    return { valid: false, input, message: 'Invalid IP address' };
  }

  try {
    if (value.includes('/')) {
      const [address, prefixLength] = ipaddr.parseCIDR(value);
      if (address.kind() !== 'ipv6' || prefixLength !== 64) {
        return { valid: false, input, message: 'Only IPv6 /64 prefixes are supported' };
      }
      const queryAddress = normalizedIpv6Network(address);
      return {
        valid: true,
        input,
        ip: `${queryAddress}/64`,
        queryAddress,
        ipVersion: 6,
        scope: scopeFor(address),
      };
    }

    const address = ipaddr.parse(value);
    const queryAddress = address.toString();
    return {
      valid: true,
      input,
      ip: queryAddress,
      queryAddress,
      ipVersion: address.kind() === 'ipv4' ? 4 : 6,
      scope: scopeFor(address),
    };
  } catch {
    return { valid: false, input, message: 'Invalid IP address' };
  }
}
