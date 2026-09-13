import ipaddr from 'ipaddr.js';

function ipv4Number(address) {
  const bytes = address.toByteArray();
  return (((bytes[0] * 256 + bytes[1]) * 256 + bytes[2]) * 256 + bytes[3]) >>> 0;
}

function ipv6Words(address) {
  const bytes = address.toByteArray();
  const words = [];
  for (let offset = 0; offset < 16; offset += 4) {
    words.push((((bytes[offset] * 256 + bytes[offset + 1]) * 256 + bytes[offset + 2]) * 256 + bytes[offset + 3]) >>> 0);
  }
  return words;
}

function maskWord(value, bits) {
  if (bits <= 0) return 0;
  if (bits >= 32) return value >>> 0;
  return (value & (0xffffffff << (32 - bits))) >>> 0;
}

function maskedWords(words, prefixLength) {
  return words.map((word, index) => maskWord(word, prefixLength - index * 32));
}

function compareWords(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function sameKey(left, right) {
  return compareWords(left, right) === 0;
}

function buildGroup(entries, wordCount) {
  entries.sort((left, right) => compareWords(left.key, right.key));
  const keys = [];
  const values = [];
  for (const entry of entries) {
    if (keys.length > 0 && sameKey(keys.at(-1), entry.key)) {
      const previous = values.at(-1);
      values[values.length - 1] = Array.isArray(previous) ? [...previous, entry.value] : [previous, entry.value];
      continue;
    }
    keys.push(entry.key);
    values.push(entry.value);
  }
  const columns = Array.from({ length: wordCount }, () => new Uint32Array(keys.length));
  for (let row = 0; row < keys.length; row += 1) {
    for (let column = 0; column < wordCount; column += 1) columns[column][row] = keys[row][column];
  }
  return { columns, values };
}

function compareAt(group, index, key) {
  for (let column = 0; column < key.length; column += 1) {
    const value = group.columns[column][index];
    if (value !== key[column]) return value < key[column] ? -1 : 1;
  }
  return 0;
}

function find(group, key) {
  let low = 0;
  let high = group.values.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const comparison = compareAt(group, middle, key);
    if (comparison === 0) return middle;
    if (comparison < 0) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

export class CompactPrefixMatcher {
  constructor() {
    this.pending = new Map([[4, new Map()], [6, new Map()]]);
    this.groups = new Map([[4, new Map()], [6, new Map()]]);
    this.prefixLengths = new Map([[4, []], [6, []]]);
    this.finalized = false;
  }

  add(cidr, value) {
    if (this.finalized) throw new Error('Cannot add prefixes after finalization');
    const [address, prefixLength] = ipaddr.parseCIDR(cidr);
    const version = address.kind() === 'ipv4' ? 4 : 6;
    const words = version === 4 ? [ipv4Number(address)] : ipv6Words(address);
    const byLength = this.pending.get(version);
    if (!byLength.has(prefixLength)) byLength.set(prefixLength, []);
    byLength.get(prefixLength).push({ key: maskedWords(words, prefixLength), value });
  }

  finalize() {
    if (this.finalized) return this;
    for (const version of [4, 6]) {
      const output = this.groups.get(version);
      for (const [prefixLength, entries] of this.pending.get(version)) {
        output.set(prefixLength, buildGroup(entries, version === 4 ? 1 : 4));
      }
      this.prefixLengths.set(version, [...output.keys()].sort((left, right) => right - left));
    }
    this.pending = null;
    this.finalized = true;
    return this;
  }

  lookup(ip) {
    if (!this.finalized) this.finalize();
    const address = ipaddr.parse(ip);
    const version = address.kind() === 'ipv4' ? 4 : 6;
    const words = version === 4 ? [ipv4Number(address)] : ipv6Words(address);
    const matches = [];
    for (const prefixLength of this.prefixLengths.get(version)) {
      const group = this.groups.get(version).get(prefixLength);
      const index = find(group, maskedWords(words, prefixLength));
      if (index < 0) continue;
      const value = group.values[index];
      matches.push(...(Array.isArray(value) ? value : [value]));
    }
    return matches;
  }
}

