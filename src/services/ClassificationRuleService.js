import fs from 'node:fs/promises';
import { PrefixMatcher } from '../ip/PrefixMatcher.js';

const NETWORK_TYPES = new Set([
  'residential', 'mobile', 'business', 'education', 'government', 'hosting', 'cdn', 'unknown',
]);
const FLAG_NAMES = new Set([
  'is_mobile', 'is_hosting', 'is_proxy', 'is_vpn', 'is_tor', 'is_anycast',
]);

function normalizeRule(rule, index) {
  const matchType = rule.match_type || rule.matchType;
  const matchValue = String(rule.match_value ?? rule.matchValue ?? '').trim();
  const networkType = rule.network_type || rule.networkType;
  const confidence = ['low', 'medium', 'high'].includes(rule.confidence)
    ? rule.confidence
    : 'medium';
  if (!['asn', 'asn_org', 'cidr'].includes(matchType) || !matchValue || !NETWORK_TYPES.has(networkType)) {
    throw new Error(`Invalid classification rule at index ${index}`);
  }
  const flags = Object.fromEntries(Object.entries(rule.flags || {}).filter(
    ([name, value]) => FLAG_NAMES.has(name) && typeof value === 'boolean',
  ));
  return {
    name: String(rule.name || `rule-${index + 1}`).slice(0, 128),
    priority: Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 100,
    matchType,
    matchValue,
    networkType,
    confidence,
    flags,
  };
}

export class ClassificationRuleService {
  constructor(rules = [], version = null) {
    this.version = version;
    this.replaceRules(rules);
  }

  static async load(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    const payload = JSON.parse(content);
    if (!payload || !Array.isArray(payload.rules)) throw new Error('Classification rules are invalid');
    return new ClassificationRuleService(payload.rules, String(payload.version || '1'));
  }

  replaceRules(rules) {
    this.rules = rules.map(normalizeRule).sort((a, b) => b.priority - a.priority);
    this.cidrMatcher = new PrefixMatcher();
    for (const rule of this.rules) {
      if (rule.matchType === 'cidr') this.cidrMatcher.add(rule.matchValue, rule);
    }
  }

  match({ ip, asn, asnOrg }) {
    const matches = [];
    for (const rule of this.rules) {
      if (rule.matchType === 'asn' && asn !== null && String(asn) === rule.matchValue) matches.push(rule);
      if (rule.matchType === 'asn_org' && asnOrg
        && asnOrg.toLocaleLowerCase('en-US').includes(rule.matchValue.toLocaleLowerCase('en-US'))) {
        matches.push(rule);
      }
    }
    matches.push(...this.cidrMatcher.lookup(ip));
    return [...new Map(matches.map((rule) => [rule.name, rule])).values()]
      .sort((a, b) => b.priority - a.priority);
  }

  publicState() {
    return {
      id: 'classification-rules',
      required: false,
      ready: true,
      status: 'ready',
      version: this.version,
      updated_at: null,
      expires_at: null,
      message: null,
    };
  }
}
