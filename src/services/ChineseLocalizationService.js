const NETWORK_TYPE = Object.freeze({
  residential: '住宅宽带', mobile: '移动网络', business: '企业 / 专线',
  education: '教育 / 机构', government: '政府网络', hosting: '云主机 / 数据中心',
  cdn: 'CDN / 边缘网络', unknown: '类型未知',
});

const CONFIDENCE = Object.freeze({ high: '高', medium: '中等', low: '较低', unknown: '未知' });
const SCOPE = Object.freeze({
  public: '公网地址', private: '私有地址', loopback: '本机回环', link_local: '链路本地',
  multicast: '组播地址', reserved: '保留地址', unknown: '未知范围',
});
const RPKI = Object.freeze({
  valid: '授权有效', invalid: '授权无效', invalid_asn: 'ASN 不匹配',
  invalid_length: '前缀长度不匹配', not_found: '未找到 ROA', unknown: '未知',
});
const JUDGMENT = Object.freeze({
  resolved: '已自动裁决', unknown: '证据不足', resolved_by_plurality: '按独立来源多数裁决',
  resolved_by_high_confidence: '高可信证据优先裁决',
  resolved_with_vote_tie: '票数相同，按固定优先级裁决',
  resolved_with_high_confidence_conflict: '高可信来源冲突，按固定优先级裁决',
});
const ASN_NAMES = Object.freeze({
  4134: '中国电信', 4837: '中国联通', 9808: '中国移动', 45102: '阿里云',
  45090: '腾讯云', 55990: '华为云', 13335: 'Cloudflare', 15169: 'Google',
  16509: 'Amazon AWS', 8075: 'Microsoft',
});

export function localizeResult(result) {
  const country = result.allocation_country || result.country_code;
  let allocationCountryName = null;
  if (country) {
    try { allocationCountryName = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(country); } catch { /* ignore */ }
  }
  return {
    ...result,
    scope_zh: SCOPE[result.scope] || result.scope,
    network_type_zh: NETWORK_TYPE[result.network_type] || result.network_type,
    confidence_zh: CONFIDENCE[result.confidence] || result.confidence,
    rpki_status_zh: result.rpki_status ? (RPKI[result.rpki_status] || result.rpki_status) : null,
    allocation_country_name: allocationCountryName,
    asn_org_zh: ASN_NAMES[result.asn] || result.canonical_org || result.asn_org,
    asn_judgment_zh: JUDGMENT[result.asn_judgment?.status] || null,
    network_judgment_zh: JUDGMENT[result.network_judgment?.status] || null,
  };
}
