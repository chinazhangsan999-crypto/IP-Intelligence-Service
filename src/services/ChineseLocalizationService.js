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
  45090: '腾讯云', 55990: '华为云', 13335: '克劳德弗莱尔边缘网络', 15169: '谷歌网络',
  16509: '亚马逊云服务', 8075: '微软云网络',
});

const SOURCE_NAMES = Object.freeze({
  'cloud-ranges': '云厂商官方网段', 'tor-exit': 'Tor 官方出口列表', 'ip2proxy-lite': '代理网络数据库',
  'apple-private-relay-ranges': '苹果隐私中继网段', 'iana-special': '特殊用途地址登记库',
  fullbogons: '未分配路由数据库', 'verified-crawlers': '已验证爬虫网段', 'ripe-ris': '互联网路由数据库',
  'rpki-vrps': '路由授权数据库', 'nro-rir-delegated': '地址资源分配登记',
  'iana-rdap-bootstrap': '网络资源登记查询目录', 'caida-as2org': '自治系统组织数据库',
  'peeringdb-networks': '网络互联资料库', 'dbip-city': '城市定位数据库', 'dbip-asn': '自治系统数据库',
  'maxmind-geolite2-city': '城市定位数据库', 'maxmind-geolite2-country': '国家定位数据库',
  'maxmind-geolite2-asn': '自治系统数据库',
});

const FIELD_NAMES = Object.freeze({
  country_code: '国家代码', country_name: '国家名称', region: '地区', state1: '一级行政区', state2: '二级行政区',
  city: '城市', postcode: '邮政编码', latitude: '纬度', longitude: '经度', timezone: '时区',
  location_conflict: '位置来源冲突', asn: '自治系统编号', asn_org: '自治系统归属', canonical_org: '统一运营组织',
  network_type: '网络类型', isp: '网络服务商', is_mobile: '移动网络', is_hosting: '托管网络',
  is_proxy: '代理网络', is_vpn: '虚拟专用网络', is_tor: 'Tor 网络', is_anycast: '任播网络',
  proxy_type: '代理类型', usage_type: '网络用途', special_purpose: '特殊用途地址', is_fullbogon: '未分配路由状态',
  verified_crawler: '官方爬虫身份', is_private_relay: '苹果隐私中继', bgp_origin_asn: '当前路由来源',
  bgp_prefix: '当前路由前缀', asn_conflict: '自治系统来源冲突', judgment_conflict: '证据裁决冲突',
  rpki_status: '路由授权状态', resource_registration: '地址资源登记', rdap_service: '地址登记查询服务',
  asn_rdap_service: '自治系统登记查询服务', peeringdb_network_type: '网络互联类别', cloud_provider: '云服务提供商',
});

const RIR = Object.freeze({ APNIC: '亚太网络信息中心', ARIN: '美国互联网号码注册管理机构', RIPE: '欧洲网络协调中心', LACNIC: '拉丁美洲及加勒比网络信息中心', AFRINIC: '非洲网络信息中心' });
const ALLOCATION_STATUS = Object.freeze({ allocated: '已分配', assigned: '已指派', available: '可分配', reserved: '保留', legacy: '历史分配' });
const CRAWLER_OPERATORS = Object.freeze({ Google: '谷歌', Bing: '必应', Apple: '苹果', Yandex: '扬德克斯', Baidu: '百度' });
const CRAWLER_TYPES = Object.freeze({ search: '搜索引擎爬虫', preview: '链接预览爬虫', training: '模型训练爬虫', assistant: '智能助手爬虫' });
const SPECIAL_PURPOSE = Object.freeze({
  'Private-Use': '私有地址', 'Loopback': '本机回环地址', 'Link-Local': '链路本地地址',
  'Documentation': '文档示例地址', 'Benchmarking': '基准测试地址', 'Shared Address Space': '共享地址空间',
  'Unique-Local': '唯一本地地址', 'IPv4-mapped Address': 'IPv4 映射地址', 'Discard-Only': '仅丢弃地址',
  'IETF Protocol Assignments': '互联网工程任务组协议分配地址', 'Special-Purpose Address': '特殊用途地址',
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

function localizedBoolean(value) {
  if (value === true || value === 'true') return '是';
  if (value === false || value === 'false') return '否';
  return null;
}

function localizedClaimValue(field, value, result) {
  if (field === 'country_code') {
    try { return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(String(value).toUpperCase()) || null; } catch { return null; }
  }
  if (field === 'state1') return localizedLocation(value, CHINESE_REGIONS);
  if (field === 'city') return localizedLocation(value, CHINESE_CITIES);
  if (field === 'timezone') return TIMEZONES[value] || null;
  if (field === 'asn_org' || field === 'canonical_org' || field === 'isp') return ASN_NAMES[result.asn] || null;
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
  if (field === 'special_purpose') return SPECIAL_PURPOSE[value] || null;
  if (field === 'verified_crawler') return '已验证官方爬虫';
  if (field === 'proxy_type') return '代理网络';
  if (field === 'usage_type') return NETWORK_TYPE[result.network_type] || '网络用途未分类';
  if (String(field || '').startsWith('is_')) return localizedBoolean(value);
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
    return {
      ...item,
      source_zh: SOURCE_NAMES[item.source] || item.source || null,
      field_zh: FIELD_NAMES[item.field] || item.field || null,
      confidence_zh: CONFIDENCE[item.confidence] || null,
      ...(valueZh && valueZh !== item.value ? { value_zh: valueZh } : {}),
    };
  }) : items);
  const organizationZh = ASN_NAMES[result.asn] || null;
  return {
    ...result,
    country_name_zh: allocationCountryName,
    region_zh: localizedLocation(result.region, CHINESE_REGIONS),
    city_zh: localizedLocation(result.city, CHINESE_CITIES),
    timezone_zh: TIMEZONES[result.timezone] || null,
    scope_zh: SCOPE[result.scope] || null,
    network_type_zh: NETWORK_TYPE[result.network_type] || null,
    network_type_confidence_zh: CONFIDENCE[result.network_type_confidence] || null,
    confidence_zh: CONFIDENCE[result.confidence] || null,
    rpki_status_zh: result.rpki_status ? (RPKI[result.rpki_status] || null) : null,
    allocation_country_name: allocationCountryName,
    status_zh: result.status === 'resolved' ? '已解析' : result.status === 'invalid' ? '地址无效' : '暂不可用',
    asn_org_zh: organizationZh,
    canonical_org_zh: organizationZh,
    isp_zh: result.isp ? organizationZh : null,
    rir_zh: RIR[result.rir] || null,
    allocation_status_zh: ALLOCATION_STATUS[String(result.allocation_status || '').toLowerCase()] || null,
    canonical_org_country_zh: result.canonical_org_country
      ? (() => { try { return new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(String(result.canonical_org_country).toUpperCase()) || null; } catch { return null; } })()
      : null,
    special_purpose_zh: result.special_purpose ? (SPECIAL_PURPOSE[result.special_purpose] || null) : null,
    crawler_operator_zh: result.crawler_operator ? (CRAWLER_OPERATORS[result.crawler_operator] || null) : null,
    crawler_type_zh: result.crawler_type ? (CRAWLER_TYPES[result.crawler_type] || null) : null,
    private_relay_region_zh: null,
    peeringdb_network_type_zh: PEERING_NETWORK_TYPES[result.peeringdb_network_type] || null,
    asn_judgment_zh: JUDGMENT[result.asn_judgment?.status] || null,
    network_judgment_zh: JUDGMENT[result.network_judgment?.status] || null,
    source_claims: enrichClaims(result.source_claims),
    evidence: enrichClaims(result.evidence),
    sources_zh: Array.isArray(result.sources) ? result.sources.map((source) => SOURCE_NAMES[source] || source) : [],
  };
}
