import { adjudicateEvidence } from './EvidenceAdjudicator.js';
const NETWORK_TYPES = new Set([
  'residential', 'mobile', 'business', 'education', 'government', 'hosting', 'cdn', 'unknown',
]);
const FLAG_FIELDS = Object.freeze([
  'is_mobile',
  'is_hosting',
  'is_proxy',
  'is_vpn',
  'is_tor',
  'is_anycast',
]);

function resolveAssertions(field, assertions, fallback) {
  return adjudicateEvidence(field, assertions, fallback);
}

export class IpJudgmentEngine {
  constructor() {
    this.assertions = new Map([['network_type', []], ...FLAG_FIELDS.map((field) => [field, []])]);
  }

  add({ field, value, source, confidence = 'medium', priority = 0 }) {
    if (!this.assertions.has(field)) throw new Error(`Unsupported judgment field: ${field}`);
    if (!source || !Number.isFinite(Number(priority))) throw new Error('Invalid judgment assertion');
    if (field === 'network_type' && !NETWORK_TYPES.has(value)) {
      throw new Error('network_type assertions require a supported value');
    }
    if (field !== 'network_type' && typeof value !== 'boolean') {
      throw new Error(`${field} assertions require a boolean value`);
    }
    this.assertions.get(field).push({
      field,
      value,
      source: String(source),
      confidence: ['unknown', 'low', 'medium', 'high'].includes(confidence) ? confidence : 'unknown',
      priority: Number(priority),
    });
    return this;
  }

  resolve() {
    const networkType = resolveAssertions('network_type', this.assertions.get('network_type'), 'unknown');
    const flagDecisions = Object.fromEntries(FLAG_FIELDS.map((field) => [
      field,
      resolveAssertions(field, this.assertions.get(field), null),
    ]));
    const decisions = [networkType, ...Object.values(flagDecisions)];
    return {
      networkType: networkType.value,
      confidence: networkType.confidence,
      flags: Object.fromEntries(FLAG_FIELDS.map((field) => [field, flagDecisions[field].value])),
      decisions,
      conflicts: decisions.filter((decision) => decision.conflicted),
    };
  }
}
