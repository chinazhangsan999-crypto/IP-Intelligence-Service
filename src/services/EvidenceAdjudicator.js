const CONFIDENCE_RANK = Object.freeze({ unknown: 0, low: 1, medium: 2, high: 3 });

const SOURCE_PRIORITY = Object.freeze({
  'classification-rules': 1200,
  'ripe-ris': 1000,
  routeviews: 950,
  'maxmind-geolite2': 800,
  dbip: 780,
  'sapics-origin-asn': 740,
  'sapics-iptoasn': 720,
  'ipgeo-community': 700,
  sapics: 650,
});

export function sourceFamily(source) {
  const id = String(source || 'unknown').toLowerCase();
  if (id.startsWith('classification-rules')) return 'classification-rules';
  if (id.includes('ripe-ris')) return 'ripe-ris';
  if (id.includes('routeviews')) return 'routeviews';
  if (id.includes('maxmind') || id.includes('geolite2')) return 'maxmind-geolite2';
  if (id === 'dbip-asn' || id === 'dbip-city' || id.startsWith('sapics-dbip')) return 'dbip';
  if (id.includes('origin-asn')) return 'sapics-origin-asn';
  if (id.includes('iptoasn')) return 'sapics-iptoasn';
  if (id.includes('ipgeo-community')) return 'ipgeo-community';
  if (id.startsWith('sapics-')) return 'sapics';
  return id;
}

function stableValue(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function valueKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : JSON.stringify(value);
}

function rank(assertion) {
  return Number.isFinite(Number(assertion.priority))
    ? Number(assertion.priority)
    : SOURCE_PRIORITY[assertion.family] || 0;
}

function orderAssertions(left, right) {
  return rank(right) - rank(left)
    || CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence]
    || left.family.localeCompare(right.family)
    || left.source.localeCompare(right.source)
    || valueKey(left.value).localeCompare(valueKey(right.value));
}

export function adjudicateEvidence(field, assertions = [], fallback = null) {
  const normalized = [];
  const seen = new Set();
  for (const item of assertions) {
    if (item?.value === null || item?.value === undefined || item?.value === '') continue;
    const source = String(item.source || 'unknown');
    const family = item.family || sourceFamily(source);
    const confidence = Object.hasOwn(CONFIDENCE_RANK, item.confidence) ? item.confidence : 'unknown';
    const assertion = { ...item, field, value: stableValue(item.value), source, family, confidence };
    const key = `${family}|${valueKey(assertion.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(assertion);
  }

  if (normalized.length === 0) {
    return {
      field, value: fallback, source: null, source_family: null, confidence: 'unknown',
      status: 'unknown', selection_basis: 'no_evidence', support_count: 0,
      total_independent_sources: 0, conflicted: false, candidates: [], alternatives: [], assertions: [],
    };
  }

  const groups = new Map();
  for (const assertion of normalized) {
    const key = valueKey(assertion.value);
    const group = groups.get(key) || { value: assertion.value, assertions: [], families: new Set() };
    group.assertions.push(assertion);
    group.families.add(assertion.family);
    groups.set(key, group);
  }
  const conflicted = groups.size > 1;
  const high = normalized.filter((item) => item.confidence === 'high').sort(orderAssertions);
  let winner;
  let selectionBasis;
  let confidence;
  let status;

  if (high.length > 0) {
    winner = high[0];
    const highValueCount = new Set(high.map((item) => valueKey(item.value))).size;
    selectionBasis = conflicted ? 'high_confidence_priority' : 'high_confidence';
    confidence = highValueCount > 1 ? 'medium' : 'high';
    status = highValueCount > 1
      ? 'resolved_with_high_confidence_conflict'
      : conflicted ? 'resolved_by_high_confidence' : 'resolved';
  } else {
    const orderedGroups = [...groups.values()].sort((left, right) => {
      const support = right.families.size - left.families.size;
      if (support !== 0) return support;
      return orderAssertions(left.assertions.toSorted(orderAssertions)[0], right.assertions.toSorted(orderAssertions)[0]);
    });
    const winningGroup = orderedGroups[0];
    winner = winningGroup.assertions.toSorted(orderAssertions)[0];
    const tied = orderedGroups.filter((item) => item.families.size === winningGroup.families.size).length > 1;
    selectionBasis = tied ? 'plurality_tie_priority' : 'independent_source_plurality';
    confidence = conflicted ? (tied ? 'low' : 'medium') : winner.confidence;
    status = conflicted ? (tied ? 'resolved_with_vote_tie' : 'resolved_by_plurality') : 'resolved';
  }

  const winningGroup = groups.get(valueKey(winner.value));
  const candidates = [...groups.values()].map((group) => ({
    value: group.value,
    support_count: group.families.size,
    source_families: [...group.families].sort(),
    sources: group.assertions.map((item) => item.source).sort(),
  })).sort((left, right) => right.support_count - left.support_count || valueKey(left.value).localeCompare(valueKey(right.value)));

  return {
    field,
    value: winner.value,
    source: winner.source,
    source_family: winner.family,
    confidence,
    status,
    selection_basis: selectionBasis,
    support_count: winningGroup.families.size,
    total_independent_sources: new Set(normalized.map((item) => item.family)).size,
    conflicted,
    candidates,
    alternatives: candidates.filter((item) => valueKey(item.value) !== valueKey(winner.value)),
    assertions: normalized.toSorted(orderAssertions),
  };
}
