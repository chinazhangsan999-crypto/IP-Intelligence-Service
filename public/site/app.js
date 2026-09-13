(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const ids = [
    'brand-link', 'service-note', 'capability-list', 'lookup-form', 'ip-input', 'lookup-button', 'detect-self',
    'input-error', 'result-shell', 'result-loading', 'result-error', 'result-content', 'error-title',
    'error-message', 'retry-button', 'ip-version', 'scope-label', 'result-ip', 'copy-ip', 'generated-at',
    'confidence-value', 'source-count', 'plain-summary', 'location-alert', 'judgment-alert', 'judgment-title',
    'judgment-summary', 'judgment-alternatives', 'location-country', 'location-detail', 'asn-value', 'asn-org',
    'network-type', 'network-note', 'isp-value', 'timezone-value', 'postcode-value', 'coordinates-value',
    'bgp-prefix', 'bgp-origin', 'rpki-status', 'bgp-consistency', 'rir-value', 'allocation-country',
    'allocation-status', 'location-consistency', 'rdap-links', 'canonical-org', 'canonical-country',
    'peering-type', 'special-identity', 'signal-grid', 'evidence-count', 'evidence-list', 'source-list', 'toast',
  ];
  const elements = Object.fromEntries(ids.map((id) => [id, byId(id)]));

  const copy = Object.freeze({
    zh: {
      pageTitle: 'IP Intelligence · 网络身份查询', pageDescription: '查询 IPv4、IPv6 的地理位置、ASN、网络类型、路由注册与代理风险信号。',
      skipLink: '跳到主要内容', serviceNote: '本地数据库 · 不保存查询历史', eyebrow: 'IP 网络信息查询',
      heroTitle: '看清一个 IP 的<br><em>网络身份</em>', heroCopy: '查询地理归属、运营商、网络类型与路由信息。每个结论都区分“明确未命中”和“当前没有足够数据”。',
      inputLabel: 'IPv4 或 IPv6 地址', inputPlaceholder: '例如 1.1.1.1 或 2606:4700:4700::1111…', lookupButton: '开始查询', lookupLoading: '查询中…',
      inputHelp: '留空可检测当前访问地址；仅支持 IP，不解析域名。', detectSelf: '检测当前地址', capabilityIp: 'IPv4 与 IPv6', capabilityLocal: '本地数据库查询', capabilityExplain: '结果可解释',
      loadingTitle: '正在识别当前网络地址', loadingCopy: '正在读取地理位置、运营商、路由与网络信号…', retryButton: '重新尝试', confidenceLabel: '结论置信度',
      countryRegion: '国家与地区', networkType: '网络类型', ispLabel: '运营商', whenAvailable: '数据源提供时显示', postcodeTimezone: '邮编与时区', coordinates: '经纬度', coordinatesHelp: '数据库定位中心点，不是设备位置',
      factsKicker: '路由与登记资料', factsTitle: '这个地址由谁管理、如何接入互联网', factsNote: '只陈述可验证信息', factsCopy: '路由表示互联网当前如何到达这个地址；登记资料表示地址资源由哪个机构分配，两者不代表访客本人位置。',
      routeTitle: '网络路由', bgpPrefix: '当前路由前缀', originAsn: '路由来源 ASN', rpkiStatus: '路由授权状态', routeConsistency: 'ASN 一致性', registrationTitle: '地址登记', registry: '登记机构', allocationCountry: '资源登记国家', allocationStatus: '分配状态与日期', locationConsistency: '登记地与定位',
      organizationTitle: '运营组织', canonicalOrg: '统一组织名称', orgCountry: '组织登记国家', peeringType: '网络自报类型', identityNote: '特殊网络身份',
      signalsKicker: '网络属性', signalsTitle: '可能影响使用场景的信号', signalsNote: '命中不等于恶意', signalsCopy: '黄色表示数据源明确命中，绿色表示明确未命中，灰色表示当前没有足够数据。网络类型不能单独用来判断访客好坏。',
      technicalTitle: '查看技术依据与数据来源', technicalCopy: '适合需要核对数据库结论的用户', evidenceKicker: '判断依据', evidenceTitle: '数据源返回了什么', coverageKicker: '数据覆盖', coverageTitle: '本次实际使用的数据源', notStored: '不保存查询结果', coverageHelp: '没有数据时显示“暂无数据”，不会自动改成“未命中”，也不会生成缺乏依据的纯净度分数。',
      readingKicker: '阅读指南', readingTitle: '先看结论，再按需查看技术信息', guideIdentityTitle: '网络身份', guideIdentityCopy: '地理位置、ASN与运营商说明地址由谁管理，不代表使用者本人身份。', guideRouteTitle: '路由与登记', guideRouteCopy: 'BGP、RPKI和RIR资料帮助判断网络路由与资源登记是否一致。', guideStateTitle: '三态结果', guideStateCopy: '“未命中”有明确证据；“暂无数据”只是当前数据库不能判断。', footerCopy: '本地数据 · 最小留存 · 结果可解释',
      brandAria: 'IP Intelligence 首页', serviceAria: '服务说明', capabilityAria: '查询能力', copyIpAria: '复制 IP 地址', unknown: '暂无数据', noFineLocation: '暂无更细位置', noPostcode: '暂无邮编数据', sourceCount: '{count} 个数据源', evidenceCount: '{count} 条', generatedAt: '北京时间 {time}',
      signalHit: '命中', signalClear: '未命中', signalUnknown: '暂无数据', summaryBase: '这是一个位于{location}、由{organization}运营的{network}地址。', summaryHits: '已识别：{items}。', summaryNoHits: '当前已查询信号中没有明确命中项。', summaryUnknowns: '另有 {count} 项暂无数据。',
      locationConflict: '不同数据源对国家与城市的判断不一致，系统已保留国家结论并隐藏冲突的城市坐标。', asnConflictTitle: 'ASN 存在来源争议，已自动裁决', asnConflictSummary: '采用 AS{asn}（{support}/{total} 个独立来源支持）', asnAlternatives: '其他结果：{items}',
      networkUnknown: '数据不足，暂不判断', networkRule: '综合本地规则判断', postcodePrefix: '邮编 {value}', bgpConsistent: '一致：登记 ASN 与当前路由相符', bgpConflict: '不一致：登记 ASN 与当前路由存在差异', bgpUnknown: '暂无足够数据判断',
      allocationValue: '{status} · {date}', locationSame: '一致：均为{country}', locationDifferent: '不同：登记为{allocation}，定位为{location}', rdapIp: '查询 IP 登记资料', rdapAsn: '查询 ASN 登记资料', noRdap: '暂无公开登记查询入口',
      specialNone: '未发现已登记的特殊网络身份', specialPurpose: '特殊用途：{value}', crawler: '官方爬虫：{value}', privateRelay: 'Apple 隐私中继{region}', emptyEvidence: '当前地址没有可展示的判断证据。', moreEvidence: '另有 {count} 条技术证据未展开显示。', evidenceMeta: '{source} · 置信度 {confidence}', unknownSource: '未知来源', noSource: '无数据源匹配',
      queryUnavailable: '查询暂时不可用', invalidTitle: 'IP 地址格式不正确', rateTitle: '查询频率过高', databaseTitle: '数据源尚未就绪', invalidMessage: '请输入有效的 IPv4 或 IPv6 地址。', rateMessage: '查询请求过于频繁，请等待限速窗口结束后重试。', databaseMessage: 'IP 数据库尚未准备完成，请稍后重试。', genericError: '服务返回异常，请稍后重试。', timeoutError: '查询超过 8 秒，请检查网络后重试。', retryLater: '请稍后重新尝试。', copied: 'IP 地址已复制', copyFailed: '复制失败，请手动选择 IP 地址',
    },
    en: {
      pageTitle: 'IP Intelligence · Network identity lookup', pageDescription: 'Look up IPv4 and IPv6 geolocation, ASN, network type, routing registration, and proxy-related signals.',
      skipLink: 'Skip to main content', serviceNote: 'Local databases · No lookup history stored', eyebrow: 'IP NETWORK LOOKUP', heroTitle: 'Understand an IP\'s<br><em>network identity</em>', heroCopy: 'Explore geolocation, operator, network type, and routing data. Results distinguish an explicit negative from a lack of data.',
      inputLabel: 'IPv4 or IPv6 address', inputPlaceholder: 'For example 1.1.1.1 or 2606:4700:4700::1111…', lookupButton: 'Look up', lookupLoading: 'Looking up…', inputHelp: 'Leave blank to inspect your current address. IP addresses only; domain names are not resolved.', detectSelf: 'Check my address', capabilityIp: 'IPv4 and IPv6', capabilityLocal: 'Local database lookup', capabilityExplain: 'Evidence-based results',
      loadingTitle: 'Identifying the current network address', loadingCopy: 'Reading geolocation, operator, routing, and network signals…', retryButton: 'Try again', confidenceLabel: 'Result confidence', countryRegion: 'Country and region', networkType: 'Network type', ispLabel: 'ISP / operator', whenAvailable: 'Shown when a source provides it', postcodeTimezone: 'Postcode and time zone', coordinates: 'Coordinates', coordinatesHelp: 'Database location centroid, not a device location',
      factsKicker: 'ROUTING AND REGISTRATION', factsTitle: 'Who manages this address and how it reaches the Internet', factsNote: 'Verifiable facts only', factsCopy: 'Routing describes how the Internet currently reaches this address. Registration describes which organization received the address resource; neither identifies the visitor.',
      routeTitle: 'Network routing', bgpPrefix: 'Current route prefix', originAsn: 'BGP origin ASN', rpkiStatus: 'Route authorization', routeConsistency: 'ASN consistency', registrationTitle: 'Address registration', registry: 'Internet registry', allocationCountry: 'Allocation country', allocationStatus: 'Status and allocation date', locationConsistency: 'Registration vs location', organizationTitle: 'Operating organization', canonicalOrg: 'Canonical organization', orgCountry: 'Organization country', peeringType: 'Self-declared network type', identityNote: 'Special network identity',
      signalsKicker: 'NETWORK ATTRIBUTES', signalsTitle: 'Signals that may affect how the address is used', signalsNote: 'A hit does not imply abuse', signalsCopy: 'Yellow is an explicit hit, green is an explicit negative, and gray means there is not enough data. Network type alone should never determine whether a visitor is trustworthy.',
      technicalTitle: 'View technical evidence and data sources', technicalCopy: 'For users who need to verify the database findings', evidenceKicker: 'EVIDENCE', evidenceTitle: 'What the sources reported', coverageKicker: 'DATA COVERAGE', coverageTitle: 'Sources used for this lookup', notStored: 'Lookup result not stored', coverageHelp: 'Missing data remains “No data”; it is never converted into “Not detected” or an unsupported purity score.',
      readingKicker: 'READING GUIDE', readingTitle: 'Read the conclusion first, then open technical detail as needed', guideIdentityTitle: 'Network identity', guideIdentityCopy: 'Geolocation, ASN, and operator describe who manages the address, not the identity of the person using it.', guideRouteTitle: 'Routing and registration', guideRouteCopy: 'BGP, RPKI, and RIR records help compare current routing with address registration.', guideStateTitle: 'Three-state results', guideStateCopy: '“Not detected” has explicit evidence. “No data” means the current databases cannot decide.', footerCopy: 'Local data · Minimal retention · Explainable results',
      brandAria: 'IP Intelligence home', serviceAria: 'Service information', capabilityAria: 'Lookup capabilities', copyIpAria: 'Copy IP address', unknown: 'No data', noFineLocation: 'No finer location data', noPostcode: 'No postcode data', sourceCount: '{count} sources', evidenceCount: '{count} items', generatedAt: 'Beijing time {time}',
      signalHit: 'Detected', signalClear: 'Not detected', signalUnknown: 'No data', summaryBase: 'Location: {location}. Operator: {organization}. Network type: {network}.', summaryHits: 'Detected: {items}.', summaryNoHits: 'No explicit hit was found among the queried signals.', summaryUnknowns: '{count} signals have no data.',
      locationConflict: 'Country and city sources disagree. The country decision was retained and conflicting city coordinates were hidden.', asnConflictTitle: 'ASN sources disagree; a deterministic decision was applied', asnConflictSummary: 'Using AS{asn} ({support} of {total} independent sources support it)', asnAlternatives: 'Other results: {items}', networkUnknown: 'Not enough data to classify', networkRule: 'Derived from local classification rules', postcodePrefix: 'Postcode {value}',
      bgpConsistent: 'Consistent: registered ASN matches the current route', bgpConflict: 'Different: registered ASN and current route do not match', bgpUnknown: 'Not enough data to compare', allocationValue: '{status} · {date}', locationSame: 'Consistent: both indicate {country}', locationDifferent: 'Different: allocation is {allocation}; location is {location}', rdapIp: 'Open IP registration record', rdapAsn: 'Open ASN registration record', noRdap: 'No public registration link available', specialNone: 'No registered special network identity found', specialPurpose: 'Special purpose: {value}', crawler: 'Verified crawler: {value}', privateRelay: 'Apple Private Relay{region}',
      emptyEvidence: 'There is no evidence to display for this address.', moreEvidence: '{count} more technical evidence items are not expanded.', evidenceMeta: '{source} · Confidence {confidence}', unknownSource: 'Unknown source', noSource: 'No data source matched', queryUnavailable: 'Lookup temporarily unavailable', invalidTitle: 'Invalid IP address', rateTitle: 'Too many lookups', databaseTitle: 'Data sources are not ready', invalidMessage: 'Enter a valid IPv4 or IPv6 address.', rateMessage: 'Too many lookup requests. Wait for the rate-limit window and try again.', databaseMessage: 'The IP databases are not ready yet. Try again shortly.', genericError: 'The service returned an error. Try again shortly.', timeoutError: 'The lookup took more than 8 seconds. Check your connection and try again.', retryLater: 'Please try again shortly.', copied: 'IP address copied', copyFailed: 'Copy failed. Select and copy the IP address manually.',
    },
  });

  const labels = Object.freeze({
    zh: {
      scope: { public: '公网地址', private: '私有地址', loopback: '本机回环', link_local: '链路本地', multicast: '组播地址', reserved: '保留地址', unknown: '未知范围' },
      network: { residential: '住宅宽带', mobile: '移动网络', business: '企业 / 专线', education: '教育 / 机构', government: '政府网络', hosting: '云主机 / 数据中心', cdn: 'CDN / 边缘网络', unknown: '类型未知' },
      confidence: { high: '高', medium: '中等', low: '较低', unknown: '未知' },
      rpki: { valid: '有效：路由已获授权', invalid: '无效：路由与授权记录不符', not_found: '未找到授权记录', unknown: '暂无数据' },
      allocation: { allocated: '已分配', assigned: '已指派', reserved: '保留', available: '可分配', legacy: '历史分配', unknown: '状态未知' },
      peering: { content: '内容网络', cable_dsl_isp: '宽带接入网络', enterprise: '企业网络', educational_research: '教育与科研网络', network_services: '网络服务', non_profit: '非营利网络', route_server: '路由服务器', government: '政府网络' },
      fields: { country_code: '国家代码', country_name: '国家名称', region: '地区', state1: '一级行政区', state2: '二级行政区', city: '城市', postcode: '邮编', latitude: '纬度', longitude: '经度', timezone: '时区', location_conflict: '位置来源冲突', asn: '自治系统编号', asn_org: 'ASN 归属', network_type: '网络类型', isp: '运营商', is_mobile: '移动网络', is_hosting: '托管网络', is_proxy: '代理', is_vpn: 'VPN', is_tor: 'Tor', is_anycast: 'Anycast', special_purpose: '特殊用途地址', is_fullbogon: 'Fullbogon 路由状态', verified_crawler: '官方爬虫身份', is_private_relay: 'Apple 隐私中继', bgp_origin_asn: '当前 BGP 来源 ASN', bgp_prefix: '当前 BGP 前缀', asn_conflict: 'ASN 来源冲突', rpki_status: 'RPKI 路由授权', resource_registration: '地址资源登记', rdap_service: 'IP RDAP 查询服务', asn_rdap_service: 'ASN RDAP 查询服务', canonical_org: '统一运营组织', peeringdb_network_type: 'PeeringDB 网络类别' },
    },
    en: {
      scope: { public: 'Public address', private: 'Private address', loopback: 'Loopback', link_local: 'Link-local', multicast: 'Multicast', reserved: 'Reserved address', unknown: 'Unknown scope' },
      network: { residential: 'Residential broadband', mobile: 'Mobile network', business: 'Business / dedicated line', education: 'Education / research', government: 'Government network', hosting: 'Hosting / data center', cdn: 'CDN / edge network', unknown: 'Unknown type' },
      confidence: { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown' },
      rpki: { valid: 'Valid: route is authorized', invalid: 'Invalid: route conflicts with authorization', not_found: 'No authorization record', unknown: 'No data' },
      allocation: { allocated: 'Allocated', assigned: 'Assigned', reserved: 'Reserved', available: 'Available', legacy: 'Legacy allocation', unknown: 'Unknown status' },
      peering: { content: 'Content network', cable_dsl_isp: 'Access network', enterprise: 'Enterprise network', educational_research: 'Education and research', network_services: 'Network services', non_profit: 'Non-profit network', route_server: 'Route server', government: 'Government network' },
      fields: { country_code: 'Country code', country_name: 'Country name', region: 'Region', state1: 'First-level region', state2: 'Second-level region', city: 'City', postcode: 'Postcode', latitude: 'Latitude', longitude: 'Longitude', timezone: 'Time zone', location_conflict: 'Location source conflict', asn: 'Autonomous system number', asn_org: 'ASN organization', network_type: 'Network type', isp: 'ISP / operator', is_mobile: 'Mobile network', is_hosting: 'Hosting network', is_proxy: 'Proxy', is_vpn: 'VPN', is_tor: 'Tor', is_anycast: 'Anycast', special_purpose: 'Special-purpose address', is_fullbogon: 'Fullbogon route status', verified_crawler: 'Verified crawler', is_private_relay: 'Apple Private Relay', bgp_origin_asn: 'Current BGP origin ASN', bgp_prefix: 'Current BGP prefix', asn_conflict: 'ASN source conflict', rpki_status: 'RPKI authorization', resource_registration: 'Resource registration', rdap_service: 'IP RDAP service', asn_rdap_service: 'ASN RDAP service', canonical_org: 'Canonical organization', peeringdb_network_type: 'PeeringDB network type' },
    },
  });

  const signals = Object.freeze([
    ['is_hosting', 'server', ['托管 / 数据中心', '服务器或云基础设施出口'], ['Hosting / data center', 'Server or cloud infrastructure egress']],
    ['is_mobile', 'mobile', ['移动网络', '蜂窝运营商或移动出口'], ['Mobile network', 'Cellular operator or mobile egress']],
    ['is_proxy', 'filter', ['代理', '代理出口信号'], ['Proxy', 'Proxy egress signal']],
    ['is_vpn', 'shield', ['VPN', '虚拟专用网络出口'], ['VPN', 'Virtual private network egress']],
    ['is_tor', 'network', ['Tor', 'Tor 出口节点'], ['Tor', 'Tor exit node']],
    ['is_anycast', 'route', ['Anycast', '多节点共享路由地址'], ['Anycast', 'Address routed from multiple locations']],
    ['is_fullbogon', 'route', ['Fullbogon', '未分配或没有全球路由的辅助证据'], ['Fullbogon', 'Evidence of unallocated or globally unrouted space']],
    ['verified_crawler', 'network', ['官方爬虫', 'Google / Bing 官方公布来源网段'], ['Verified crawler', 'Official Google or Bing crawler range']],
    ['is_private_relay', 'shield', ['隐私中继', 'Apple iCloud Private Relay 出口'], ['Private Relay', 'Apple iCloud Private Relay egress']],
  ]);
  const iconPaths = Object.freeze({
    server: 'M4 4h16v6H4V4Zm2 2v2h2V6H6Zm-2 6h16v8H4v-8Zm2 2v4h2v-4H6Z', mobile: 'M7 2h10v20H7V2Zm2 2v14h6V4H9Zm2 16h2v-1h-2v1Z', filter: 'M3 4h18l-7 8v6l-4 2v-8L3 4Zm4.4 2 4.6 5.2L16.6 6H7.4Z', shield: 'M12 2 20 6v6c0 5.1-3.4 8.7-8 10-4.6-1.3-8-4.9-8-10V6l8-4Zm0 4.2L8 8v4c0 2.9 1.6 5 4 6.1 2.4-1.1 4-3.2 4-6.1V8l-4-1.8Z', network: 'M5 3h4v4H8v4h3v-1h4v4h-4v-1H8v4h1v4H5v-4h1V7H5V3Zm10 0h4v4h-4V3Zm0 14h4v4h-4v-4Z', route: 'M6 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm12 12a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM7 8v3c0 3.3 2.7 6 6 6h2v2h-2a8 8 0 0 1-8-8V8h2Zm8-5h4v4h-2V5h-2V3Z',
  });

  const storageKey = 'ip-intelligence-language';
  let language = readLanguage();
  let lastQuery = '';
  let lastPayload = null;
  let lastError = null;
  let requestSequence = 0;
  let loading = false;
  let toastTimer = null;

  function readLanguage() { try { return localStorage.getItem(storageKey) === 'en' ? 'en' : 'zh'; } catch { return 'zh'; } }
  function t(key, values = {}) { let value = copy[language][key] || copy.zh[key] || key; for (const [name, replacement] of Object.entries(values)) value = value.replaceAll(`{${name}}`, String(replacement)); return value; }
  function text(value, fallback = null) { return value === null || value === undefined || value === '' ? (fallback || t('unknown')) : String(value); }
  function translated(group, value, fallback = 'unknown') { return labels[language][group]?.[value] || labels[language][group]?.[fallback] || text(value); }

  function applyLanguage() {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = t('pageTitle');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('pageDescription'));
    document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach((node) => { node.innerHTML = t(node.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder)));
    document.querySelectorAll('[data-language]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.language === language)));
    elements['brand-link'].setAttribute('aria-label', t('brandAria'));
    elements['service-note'].setAttribute('aria-label', t('serviceAria'));
    elements['capability-list'].setAttribute('aria-label', t('capabilityAria'));
    elements['copy-ip'].setAttribute('aria-label', t('copyIpAria'));
    setButtonLoading(loading);
    if (lastPayload) renderResult(lastPayload.data, lastPayload.meta);
    else if (lastError) showError(lastError.error, lastError.response, false);
  }

  function createIcon(name) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', iconPaths[name]); svg.append(path); return svg; }
  function formatTime(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) return '--'; return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date); }
  function formatDate(value) { if (!value) return t('unknown'); const compact = String(value).replace(/[^0-9]/g, ''); return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : String(value); }
  function countryName(code, supplied = null) { if (!code) return supplied || t('unknown'); try { return new Intl.DisplayNames([language === 'zh' ? 'zh-CN' : 'en'], { type: 'region' }).of(code) || supplied || code; } catch { return supplied || code; } }
  function showToast(message) { clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.hidden = false; toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 3200); }
  function setView(view) { elements['result-loading'].hidden = view !== 'loading'; elements['result-error'].hidden = view !== 'error'; elements['result-content'].hidden = view !== 'content'; elements['result-shell'].setAttribute('aria-busy', view === 'loading' ? 'true' : 'false'); }
  function setButtonLoading(value) { loading = value; elements['lookup-button'].disabled = value; elements['lookup-button'].querySelector('span').textContent = value ? t('lookupLoading') : t('lookupButton'); }
  function signalState(value) { return value === true ? ['yes', t('signalHit')] : value === false ? ['no', t('signalClear')] : ['unknown', t('signalUnknown')]; }

  function renderSummary(data) {
    const location = [countryName(data.country_code, language === 'zh' ? (data.country_name_zh || data.country_name) : data.country_name), language === 'zh' ? (data.region_zh || data.region) : data.region, language === 'zh' ? (data.city_zh || data.city) : data.city].filter((value, index, list) => value && value !== t('unknown') && list.indexOf(value) === index).join(language === 'zh' ? ' · ' : ', ') || t('unknown');
    const hits = signals.filter(([field]) => data[field] === true).map((item) => item[language === 'zh' ? 2 : 3][0]);
    const unknowns = signals.filter(([field]) => data[field] === null || data[field] === undefined).length;
    const organization = text(data.asn_org || data.canonical_org || data.isp).replace(/[.!?。！？]+$/u, '');
    const parts = [t('summaryBase', { location, organization, network: translated('network', data.network_type) }), hits.length ? t('summaryHits', { items: hits.join(language === 'zh' ? '、' : ', ') }) : t('summaryNoHits')];
    if (unknowns) parts.push(t('summaryUnknowns', { count: unknowns }));
    elements['plain-summary'].textContent = parts.join(' ');
  }

  function renderSignals(data) {
    const fragment = document.createDocumentFragment();
    for (const [field, icon, zh, en] of signals) {
      const [state, stateLabel] = signalState(data[field]);
      const [label, description] = language === 'zh' ? zh : en;
      const item = document.createElement('div'); item.className = 'signal-item'; item.dataset.state = state;
      const iconWrap = document.createElement('span'); iconWrap.className = 'signal-icon'; iconWrap.append(createIcon(icon));
      const body = document.createElement('div'); const strong = document.createElement('strong'); const small = document.createElement('small');
      strong.textContent = `${label} · ${stateLabel}`; small.textContent = description; body.append(strong, small); item.append(iconWrap, body); fragment.append(item);
    }
    elements['signal-grid'].replaceChildren(fragment);
  }

  function renderEvidence(evidence) {
    const rows = Array.isArray(evidence) ? evidence : [];
    elements['evidence-count'].textContent = t('evidenceCount', { count: rows.length });
    if (!rows.length) { const empty = document.createElement('p'); empty.className = 'empty-state'; empty.textContent = t('emptyEvidence'); elements['evidence-list'].replaceChildren(empty); return; }
    const fragment = document.createDocumentFragment();
    for (const row of rows.slice(0, 60)) {
      const item = document.createElement('div'); item.className = 'evidence-item';
      const body = document.createElement('div'); const strong = document.createElement('strong'); const small = document.createElement('small'); const code = document.createElement('code');
      strong.textContent = labels[language].fields[row.field] || text(row.field); small.textContent = t('evidenceMeta', { source: sourceName(row.source), confidence: translated('confidence', row.confidence) }); code.textContent = text(language === 'zh' ? (row.value_zh || row.value) : row.value); if (language === 'zh' && row.value_zh && row.value_zh !== row.value) code.title = text(row.value);
      body.append(strong, small); item.append(body, code); fragment.append(item);
    }
    if (rows.length > 60) { const more = document.createElement('p'); more.className = 'evidence-more'; more.textContent = t('moreEvidence', { count: rows.length - 60 }); fragment.append(more); }
    elements['evidence-list'].replaceChildren(fragment);
  }

  function sourceName(source) { const names = { 'cloud-ranges': ['云厂商官方网段', 'Official cloud ranges'], 'tor-exit': ['Tor 官方出口列表', 'Official Tor exit list'], 'ip2proxy-lite': ['IP2Proxy Lite 代理库', 'IP2Proxy Lite'], 'apple-private-relay-ranges': ['Apple 隐私中继网段', 'Apple Private Relay ranges'], 'iana-special': ['IANA 特殊用途地址库', 'IANA special-purpose registry'], 'fullbogons': ['Fullbogon 路由库', 'Fullbogon route list'], 'verified-crawlers': ['已验证爬虫网段', 'Verified crawler ranges'], 'ripe-ris': ['RIPE RIS 路由库', 'RIPE RIS'], 'rpki-vrps': ['RPKI 路由授权库', 'RPKI VRPs'], 'nro-rir-delegated': ['RIR 地址分配登记', 'RIR delegated statistics'], 'iana-rdap-bootstrap': ['IANA RDAP 引导库', 'IANA RDAP bootstrap'], 'caida-as2org': ['CAIDA ASN 组织库', 'CAIDA AS-to-Organization'], 'peeringdb-networks': ['PeeringDB 网络资料', 'PeeringDB networks'], 'dbip-city': ['DB-IP 城市库', 'DB-IP City'], 'dbip-asn': ['DB-IP ASN 库', 'DB-IP ASN'], 'maxmind-geolite2-city': ['GeoLite2 城市库', 'GeoLite2 City'], 'maxmind-geolite2-country': ['GeoLite2 国家库', 'GeoLite2 Country'], 'maxmind-geolite2-asn': ['GeoLite2 ASN 库', 'GeoLite2 ASN'] }; return names[source]?.[language === 'zh' ? 0 : 1] || source; }
  function renderSources(data, meta) { const sources = [...new Set(Array.isArray(data.sources) ? data.sources : [])]; const versions = meta?.database_versions || {}; const fragment = document.createDocumentFragment(); for (const source of sources) { const chip = document.createElement('span'); chip.className = 'source-chip'; chip.title = source; chip.textContent = versions[source] ? `${sourceName(source)} · ${versions[source]}` : sourceName(source); fragment.append(chip); } if (!sources.length) { const chip = document.createElement('span'); chip.className = 'source-chip'; chip.textContent = t('noSource'); fragment.append(chip); } elements['source-list'].replaceChildren(fragment); }
  function safeHttps(value) { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; } }
  function renderRdap(data) { const candidates = [...(Array.isArray(data.rdap_urls) ? data.rdap_urls.map((url) => [url, t('rdapIp')]) : []), ...(Array.isArray(data.asn_rdap_urls) ? data.asn_rdap_urls.map((url) => [url, t('rdapAsn')]) : [])]; const fragment = document.createDocumentFragment(); const seen = new Set(); for (const [value, label] of candidates) { const href = safeHttps(value); if (!href || seen.has(href)) continue; seen.add(href); const anchor = document.createElement('a'); anchor.href = href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = label; fragment.append(anchor); } if (!fragment.childNodes.length) { const span = document.createElement('span'); span.textContent = t('noRdap'); fragment.append(span); } elements['rdap-links'].replaceChildren(fragment); }

  function renderFacts(data) {
    elements['bgp-prefix'].textContent = text(data.bgp_prefix);
    const origins = Array.isArray(data.bgp_origin_asns) && data.bgp_origin_asns.length ? data.bgp_origin_asns : (data.bgp_origin_asn === null || data.bgp_origin_asn === undefined ? [] : [data.bgp_origin_asn]);
    elements['bgp-origin'].textContent = origins.length ? origins.map((value) => `AS${value}`).join(' · ') : t('unknown');
    elements['rpki-status'].textContent = labels[language].rpki[data.rpki_status] || text(data.rpki_status);
    elements['bgp-consistency'].textContent = data.bgp_conflict === true ? t('bgpConflict') : data.bgp_conflict === false ? t('bgpConsistent') : t('bgpUnknown');
    elements['rir-value'].textContent = text(data.rir);
    elements['allocation-country'].textContent = data.allocation_country ? countryName(data.allocation_country) : t('unknown');
    const status = labels[language].allocation[data.allocation_status] || text(data.allocation_status);
    elements['allocation-status'].textContent = data.allocation_date ? t('allocationValue', { status, date: formatDate(data.allocation_date) }) : status;
    if (data.allocation_country && data.country_code) { const allocation = countryName(data.allocation_country); const location = countryName(data.country_code, data.country_name); elements['location-consistency'].textContent = data.allocation_country === data.country_code ? t('locationSame', { country: location }) : t('locationDifferent', { allocation, location }); } else elements['location-consistency'].textContent = t('unknown');
    renderRdap(data);
    elements['canonical-org'].textContent = text(data.canonical_org);
    elements['canonical-country'].textContent = data.canonical_org_country ? countryName(data.canonical_org_country) : t('unknown');
    const peeringTypeKey = typeof data.peeringdb_network_type === 'string'
      ? data.peeringdb_network_type.trim().toLowerCase().replace(/[\s/-]+/g, '_')
      : null;
    elements['peering-type'].textContent = labels[language].peering[peeringTypeKey] || text(data.peeringdb_network_type);
    const identities = [];
    if (data.special_purpose) identities.push(t('specialPurpose', { value: data.special_purpose }));
    if (data.verified_crawler === true) identities.push(t('crawler', { value: [data.crawler_operator, data.crawler_type].filter(Boolean).join(' · ') || t('signalHit') }));
    if (data.is_private_relay === true) identities.push(t('privateRelay', { region: data.private_relay_region ? ` · ${data.private_relay_region}` : '' }));
    const explicitNone = !data.special_purpose && data.verified_crawler === false && data.is_private_relay === false;
    elements['special-identity'].textContent = identities.join(language === 'zh' ? '；' : '; ') || (explicitNone ? t('specialNone') : t('unknown'));
  }

  function renderResult(data, meta) {
    lastPayload = { data, meta }; lastError = null;
    elements['ip-version'].textContent = data.ip_version ? `IPv${data.ip_version}` : 'IP'; elements['scope-label'].textContent = translated('scope', data.scope); elements['result-ip'].textContent = text(data.ip, '--');
    elements['generated-at'].textContent = t('generatedAt', { time: formatTime(meta?.generated_at) }); elements['confidence-value'].textContent = translated('confidence', data.confidence); elements['source-count'].textContent = t('sourceCount', { count: Array.isArray(data.sources) ? data.sources.length : 0 });
    elements['location-country'].textContent = countryName(data.country_code, language === 'zh' ? (data.country_name_zh || data.country_name) : data.country_name); elements['location-detail'].textContent = [language === 'zh' ? (data.region_zh || data.region) : data.region, language === 'zh' ? (data.city_zh || data.city) : data.city].filter((value, index, list) => value && list.indexOf(value) === index).join(' · ') || t('noFineLocation');
    elements['asn-value'].textContent = data.asn === null || data.asn === undefined ? t('unknown') : `AS${data.asn}`; elements['asn-org'].textContent = text(language === 'zh' ? (data.asn_org_zh || data.asn_org) : data.asn_org); elements['network-type'].textContent = translated('network', data.network_type); elements['network-note'].textContent = data.network_type === 'unknown' ? t('networkUnknown') : t('networkRule');
    elements['isp-value'].textContent = text(language === 'zh' ? (data.isp_zh || data.isp) : data.isp); elements['timezone-value'].textContent = text(language === 'zh' ? (data.timezone_zh || data.timezone) : data.timezone); elements['postcode-value'].textContent = data.postcode ? t('postcodePrefix', { value: data.postcode }) : t('noPostcode');
    const coordinates = data.latitude !== null && data.longitude !== null && Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude)); elements['coordinates-value'].textContent = coordinates ? `${Number(data.latitude).toFixed(4)}, ${Number(data.longitude).toFixed(4)}` : t('unknown');
    const locationConflict = Array.isArray(data.evidence) ? data.evidence.find((item) => item.field === 'location_conflict') : null; elements['location-alert'].hidden = !locationConflict; elements['location-alert'].textContent = locationConflict ? t('locationConflict') : '';
    const judgment = data.asn_judgment; const disputed = Boolean(judgment?.conflicted); elements['judgment-alert'].hidden = !disputed; elements['judgment-title'].textContent = disputed ? t('asnConflictTitle') : ''; elements['judgment-summary'].textContent = disputed ? t('asnConflictSummary', { asn: judgment.value, support: judgment.support_count, total: judgment.total_independent_sources }) : ''; elements['judgment-alternatives'].textContent = disputed && Array.isArray(judgment.alternatives) ? t('asnAlternatives', { items: judgment.alternatives.map((item) => `AS${item.value} (${item.support_count})`).join(language === 'zh' ? '、' : ', ') }) : '';
    renderSummary(data); renderFacts(data); renderSignals(data); renderEvidence(data.evidence); renderSources(data, meta); setView('content');
  }

  function showError(error, response, remember = true) {
    if (remember) { lastPayload = null; lastError = { error, response }; }
    const titleKey = { 400: 'invalidTitle', 429: 'rateTitle', 503: 'databaseTitle' }[response?.status] || 'queryUnavailable';
    const messageKey = { 400: 'invalidMessage', 429: 'rateMessage', 503: 'databaseMessage' }[response?.status];
    elements['error-title'].textContent = t(titleKey); elements['error-message'].textContent = messageKey ? t(messageKey) : error?.localizedKey ? t(error.localizedKey) : error?.message || t('retryLater'); setView('error');
  }

  async function lookup(query, { updateUrl = true } = {}) {
    const sequence = ++requestSequence; lastQuery = query.trim(); lastPayload = null; lastError = null; elements['input-error'].hidden = true; setButtonLoading(true); setView('loading');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000); const endpoint = lastQuery ? `/api/public/lookup?ip=${encodeURIComponent(lastQuery)}` : '/api/public/lookup';
    try { const response = await fetch(endpoint, { signal: controller.signal, headers: { accept: 'application/json' } }); const payload = await response.json().catch(() => null); if (!response.ok) { const error = new Error(t('genericError')); error.response = response; throw error; } if (!payload?.data || sequence !== requestSequence) return; renderResult(payload.data, payload.meta); if (updateUrl) history.replaceState(null, '', lastQuery ? `/?ip=${encodeURIComponent(lastQuery)}` : '/'); }
    catch (error) { if (sequence !== requestSequence) return; if (error.name === 'AbortError') error.localizedKey = 'timeoutError'; showError(error, error.response); }
    finally { clearTimeout(timeout); if (sequence === requestSequence) setButtonLoading(false); }
  }

  elements['lookup-form'].addEventListener('submit', (event) => { event.preventDefault(); lookup(elements['ip-input'].value); });
  elements['detect-self'].addEventListener('click', () => { elements['ip-input'].value = ''; lookup(''); });
  elements['retry-button'].addEventListener('click', () => lookup(lastQuery));
  elements['copy-ip'].addEventListener('click', async () => { try { await navigator.clipboard.writeText(elements['result-ip'].textContent); showToast(t('copied')); } catch { showToast(t('copyFailed')); } });
  document.querySelectorAll('[data-language]').forEach((button) => button.addEventListener('click', () => { if (button.dataset.language === language) return; language = button.dataset.language; try { localStorage.setItem(storageKey, language); } catch { /* Optional preference storage. */ } applyLanguage(); }));

  applyLanguage();
  const initialQuery = new URLSearchParams(location.search).get('ip') || '';
  elements['ip-input'].value = initialQuery;
  lookup(initialQuery, { updateUrl: false });
})();
