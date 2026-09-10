const CONFIDENCE_RANK = Object.freeze({ unknown: 0, low: 1, medium: 2, high: 3 });
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

function normalizeConfidence(value) {
  return Object.hasOwn(CONFIDENCE_RANK, value) ? value : 'unknown';
}

function compareAssertions(left, right) {
  return right.priority - left.priority
    || CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence]
    || left.source.localeCompare(right.source);
}

function uniqueAssertions(assertions) {
  const seen = new Set();
  return assertions.filter((assertion) => {
    const key = `${assertion.source}|${String(assertion.value)}|${assertion.priority}|${assertion.confidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveAssertions(field, assertions, fallback) {
  const ordered = uniqueAssertions(assertions).sort(compareAssertions);
  if (ordered.length === 0) {
    return { field, value: fallback, source: null, confidence: 'unknown', conflicted: false };
  }

  const strongest = ordered[0];
  const tied = ordered.filter((item) => (
    item.priority === strongest.priority && item.confidence === strongest.confidence
  ));
  const tiedValues = new Set(tied.map((item) => item.value));
  const conflicted = new Set(ordered.map((item) => item.value)).size > 1;

  if (tiedValues.size > 1) {
    return {
      field,
      value: fallback,
      source: null,
      confidence: 'unknown',
      conflicted: true,
      assertions: ordered,
    };
  }

  return {
    field,
    value: strongest.value,
    source: strongest.source,
    confidence: strongest.confidence,
    conflicted,
    assertions: ordered,
  };
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
      confidence: normalizeConfidence(confidence),
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
