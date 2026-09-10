import ipaddr from 'ipaddr.js';

function family(address) {
  return address.kind() === 'ipv4' ? 4 : 6;
}

function prefixKey(address, prefixLength) {
  const bytes = address.toByteArray();
  const wholeBytes = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;
  const length = wholeBytes + (remainingBits > 0 ? 1 : 0);
  const prefix = bytes.slice(0, length);
  if (remainingBits > 0) prefix[prefix.length - 1] &= 0xff << (8 - remainingBits);
  return Buffer.from(prefix).toString('hex');
}

export class PrefixMatcher {
  constructor() {
    this.families = new Map([[4, new Map()], [6, new Map()]]);
    this.prefixLengths = new Map([[4, []], [6, []]]);
  }

  add(cidr, value) {
    const [address, prefixLength] = ipaddr.parseCIDR(cidr);
    const version = family(address);
    const byLength = this.families.get(version);
    if (!byLength.has(prefixLength)) byLength.set(prefixLength, new Map());
    const byPrefix = byLength.get(prefixLength);
    const key = prefixKey(address, prefixLength);
    if (!byPrefix.has(key)) byPrefix.set(key, []);
    byPrefix.get(key).push(value);
    this.prefixLengths.set(version, [...byLength.keys()].sort((a, b) => b - a));
  }

  lookup(ip) {
    const address = ipaddr.parse(ip);
    const version = family(address);
    const matches = [];
    for (const prefixLength of this.prefixLengths.get(version)) {
      const values = this.families.get(version).get(prefixLength).get(prefixKey(address, prefixLength));
      if (values) matches.push(...values);
    }
    return matches;
  }
}
