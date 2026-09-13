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

const CHINESE_REGIONS = Object.freeze({
  Anhui: '安徽省', Beijing: '北京市', Chongqing: '重庆市', Fujian: '福建省', Gansu: '甘肃省',
  Guangdong: '广东省', Guangxi: '广西壮族自治区', Guizhou: '贵州省', Hainan: '海南省', Hebei: '河北省',
  Heilongjiang: '黑龙江省', Henan: '河南省', Hubei: '湖北省', Hunan: '湖南省', 'Inner Mongolia': '内蒙古自治区',
  Jiangsu: '江苏省', Jiangxi: '江西省', Jilin: '吉林省', Liaoning: '辽宁省', Ningxia: '宁夏回族自治区',
  Qinghai: '青海省', Shaanxi: '陕西省', Shandong: '山东省', Shanghai: '上海市', Shanxi: '山西省',
  Sichuan: '四川省', Tianjin: '天津市', Tibet: '西藏自治区', Xinjiang: '新疆维吾尔自治区', Yunnan: '云南省',
  Zhejiang: '浙江省', 'Hong Kong': '香港特别行政区', Macau: '澳门特别行政区', Taiwan: '台湾省',
});

const CHINESE_CITIES = Object.freeze({
  Beijing: '北京市', Tianjin: '天津市', Shanghai: '上海市', Chongqing: '重庆市', Zhengzhou: '郑州市',
  Wuhan: '武汉市', Changsha: '长沙市', Guangzhou: '广州市', Shenzhen: '深圳市', Chengdu: '成都市',
  Hangzhou: '杭州市', Nanjing: '南京市', Suzhou: '苏州市', Ningbo: '宁波市', Hefei: '合肥市',
  Fuzhou: '福州市', Xiamen: '厦门市', Nanchang: '南昌市', Jinan: '济南市', Qingdao: '青岛市',
  Shijiazhuang: '石家庄市', Taiyuan: '太原市', Shenyang: '沈阳市', Dalian: '大连市', Changchun: '长春市',
  Harbin: '哈尔滨市', Haikou: '海口市', Guiyang: '贵阳市', Kunming: '昆明市', "Xi'an": '西安市',
  Xian: '西安市', Lanzhou: '兰州市', Xining: '西宁市', Hohhot: '呼和浩特市', Nanning: '南宁市',
  Lhasa: '拉萨市', Yinchuan: '银川市', Urumqi: '乌鲁木齐市', Wuxi: '无锡市', Wenzhou: '温州市',
  Foshan: '佛山市', Dongguan: '东莞市', Quanzhou: '泉州市', Jiaxing: '嘉兴市', Nantong: '南通市',
  Luoyang: '洛阳市', Baoding: '保定市', Tangshan: '唐山市', Taipei: '台北市', 'Hong Kong': '香港', Macau: '澳门',
});

const TIMEZONES = Object.freeze({
  'Asia/Shanghai': '中国标准时间（UTC+08:00）', 'Asia/Hong_Kong': '香港时间（UTC+08:00）',
  'Asia/Taipei': '台北时间（UTC+08:00）', UTC: '协调世界时（UTC）', 'Etc/UTC': '协调世界时（UTC）',
  'America/Los_Angeles': '北美太平洋时间', 'America/New_York': '北美东部时间',
  'Europe/London': '英国时间', 'Europe/Paris': '中欧时间', 'Asia/Tokyo': '日本标准时间',
});

const PEERING_NETWORK_TYPES = Object.freeze({
  NSP: '网络服务提供商', 'Cable/DSL/ISP': '宽带接入网络', Content: '内容网络',
  Enterprise: '企业网络', 'Educational/Research': '教育与科研网络', Government: '政府网络',
  'Non-Profit': '非营利网络', 'Route Server': '路由服务器',
});

function localizedLocation(value, dictionary) {
  return dictionary[String(value || '').trim()] || null;
}

function localizedClaimValue(field, value, result) {
  if (field === 'country_code') {
    try { return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(String(value).toUpperCase()) || null; } catch { return null; }
  }
  if (field === 'state1') return localizedLocation(value, CHINESE_REGIONS);
  if (field === 'city') return localizedLocation(value, CHINESE_CITIES);
  if (field === 'timezone') return TIMEZONES[value] || null;
  if (field === 'asn_org' || field === 'canonical_org') return ASN_NAMES[result.asn] || null;
  if (field === 'bgp_origin_asn') return ASN_NAMES[Number(String(value).replace(/^AS/i, ''))]
    ? `${value}（${ASN_NAMES[Number(String(value).replace(/^AS/i, ''))]}）` : null;
  if (field === 'rpki_status') return RPKI[value] || null;
  if (field === 'peeringdb_network_type') return PEERING_NETWORK_TYPES[value] || null;
  if (field === 'resource_registration') {
    const [registry, country, status] = String(value).split(':');
    const registryZh = { APNIC: '亚太网络信息中心', ARIN: '美国互联网号码注册管理机构', RIPE: '欧洲网络协调中心', LACNIC: '拉丁美洲及加勒比网络信息中心', AFRINIC: '非洲网络信息中心' }[registry] || registry;
    const statusZh = { allocated: '已分配', assigned: '已指派', available: '可分配', reserved: '保留' }[String(status || '').toLowerCase()] || status;
    try {
      const countryZh = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(String(country || '').toUpperCase()) || country;
      return [registryZh, countryZh, statusZh].filter(Boolean).join(' · ');
    } catch { return [registryZh, country, statusZh].filter(Boolean).join(' · '); }
  }
  return null;
}

export function localizeResult(result) {
  const country = result.allocation_country || result.country_code;
  let allocationCountryName = null;
  if (country) {
    try { allocationCountryName = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(country); } catch { /* ignore */ }
  }
  const enrichClaims = (items) => (Array.isArray(items) ? items.map((item) => {
    const valueZh = localizedClaimValue(item.field, item.value, result);
    return valueZh && valueZh !== item.value ? { ...item, value_zh: valueZh } : item;
  }) : items);
  return {
    ...result,
    country_name_zh: allocationCountryName || result.country_name || null,
    region_zh: localizedLocation(result.region, CHINESE_REGIONS),
    city_zh: localizedLocation(result.city, CHINESE_CITIES),
    timezone_zh: TIMEZONES[result.timezone] || null,
    scope_zh: SCOPE[result.scope] || result.scope,
    network_type_zh: NETWORK_TYPE[result.network_type] || result.network_type,
    network_type_confidence_zh: CONFIDENCE[result.network_type_confidence] || result.network_type_confidence,
    confidence_zh: CONFIDENCE[result.confidence] || result.confidence,
    rpki_status_zh: result.rpki_status ? (RPKI[result.rpki_status] || result.rpki_status) : null,
    allocation_country_name: allocationCountryName,
    asn_org_zh: ASN_NAMES[result.asn] || result.canonical_org || result.asn_org,
    canonical_org_zh: ASN_NAMES[result.asn] || null,
    peeringdb_network_type_zh: PEERING_NETWORK_TYPES[result.peeringdb_network_type] || null,
    asn_judgment_zh: JUDGMENT[result.asn_judgment?.status] || null,
    network_judgment_zh: JUDGMENT[result.network_judgment?.status] || null,
    source_claims: enrichClaims(result.source_claims),
    evidence: enrichClaims(result.evidence),
  };
}
