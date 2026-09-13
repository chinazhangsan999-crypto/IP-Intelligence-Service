const EXTERNAL_LOOKUP_FIELDS = Object.freeze([
  'input',
  'status',
  'message',
  'ip',
  'ip_version',
  'scope',
  'scope_zh',
  'country_code',
  'country_name',
  'country_name_zh',
  'region',
  'region_zh',
  'city',
  'city_zh',
  'state1',
  'state2',
  'postcode',
  'latitude',
  'longitude',
  'timezone',
  'timezone_zh',
  'asn',
  'asn_org',
  'asn_org_zh',
  'isp',
  'network_type',
  'network_type_zh',
  'network_type_confidence',
  'network_type_confidence_zh',
  'is_mobile',
  'is_hosting',
  'is_proxy',
  'is_vpn',
  'is_tor',
  'is_anycast',
  'special_purpose',
  'is_fullbogon',
  'verified_crawler',
  'crawler_operator',
  'crawler_type',
  'is_private_relay',
  'private_relay_region',
  'confidence',
  'confidence_zh',
  'bgp_origin_asn',
  'bgp_origin_asns',
  'bgp_prefix',
  'bgp_conflict',
  'rpki_status',
  'rir',
  'allocation_country',
  'allocation_status',
  'allocation_date',
  'rdap_urls',
  'asn_rdap_urls',
  'canonical_org',
  'canonical_org_zh',
  'canonical_org_country',
  'peeringdb_network_type',
  'peeringdb_network_type_zh',
  'sources',
  'source_claims',
  'evidence',
  'country_judgment',
  'asn_judgment',
  'asn_org_judgment',
  'network_judgment',
  'asn_judgment_zh',
  'network_judgment_zh',
]);

/**
 * The formal client API preserves all public database observations so callers
 * can present a complete, explainable profile instead of losing supplemental
 * fields during the navigation-site cache hop.
 */
export function projectExternalLookupItem(item) {
  if (!item || typeof item !== 'object') return item;
  const projected = {};
  for (const field of EXTERNAL_LOOKUP_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(item, field)) projected[field] = item[field];
  }
  return projected;
}

export function projectExternalLookupBatch(result) {
  return {
    ...result,
    data: Array.isArray(result?.data) ? result.data.map(projectExternalLookupItem) : [],
  };
}
