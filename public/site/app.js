(() => {
  'use strict';

  const byId = (id) => document.getElementById(id);
  const elements = Object.fromEntries([
    'lookup-form', 'ip-input', 'lookup-button', 'detect-self', 'input-error',
    'result-shell', 'result-loading', 'result-error', 'result-content',
    'error-title', 'error-message', 'retry-button', 'ip-version', 'scope-label',
    'result-ip', 'copy-ip', 'generated-at', 'confidence-value', 'source-count',
    'location-country', 'location-detail', 'asn-value', 'asn-org', 'network-type',
    'network-note', 'isp-value', 'timezone-value', 'postcode-value', 'coordinates-value',
    'location-alert', 'signal-grid', 'evidence-count', 'evidence-list', 'source-list', 'toast',
  ].map((id) => [id, byId(id)]));

  const labels = Object.freeze({
    scope: {
      public: '公网地址', private: '私有地址', loopback: '本机回环',
      link_local: '链路本地', multicast: '组播地址', reserved: '保留地址', unknown: '未知范围',
    },
    network: {
      residential: '住宅宽带', mobile: '移动网络', business: '企业 / 专线',
      education: '教育 / 机构', government: '政府网络', hosting: '云主机 / 数据中心',
      cdn: 'CDN / 边缘网络', unknown: '类型未知',
    },
    confidence: { high: '高', medium: '中等', low: '较低', unknown: '未知' },
    fields: {
      country_code: '国家代码', region: '地区', city: '城市', location_conflict: '位置来源冲突', asn: 'ASN',
      asn_org: 'ASN 归属', network_type: '网络类型', isp: '运营商',
      is_mobile: '移动网络', is_hosting: '托管网络', is_proxy: '代理',
      is_vpn: 'VPN', is_tor: 'Tor', is_anycast: 'Anycast',
    },
  });

  const signalDefinitions = Object.freeze([
    ['is_hosting', '托管 / 数据中心', '服务器或云基础设施出口', 'server'],
    ['is_mobile', '移动网络', '蜂窝运营商或移动出口', 'mobile'],
    ['is_proxy', '代理', '代理出口信号', 'filter'],
    ['is_vpn', 'VPN', '虚拟专用网络出口', 'shield'],
    ['is_tor', 'Tor', 'Tor 出口节点', 'network'],
    ['is_anycast', 'Anycast', '多节点共享路由地址', 'route'],
  ]);

  const iconPaths = Object.freeze({
    server: 'M4 4h16v6H4V4Zm2 2v2h2V6H6Zm-2 6h16v8H4v-8Zm2 2v4h2v-4H6Z',
    mobile: 'M7 2h10v20H7V2Zm2 2v14h6V4H9Zm2 16h2v-1h-2v1Z',
    filter: 'M3 4h18l-7 8v6l-4 2v-8L3 4Zm4.4 2 4.6 5.2L16.6 6H7.4Z',
    shield: 'M12 2 20 6v6c0 5.1-3.4 8.7-8 10-4.6-1.3-8-4.9-8-10V6l8-4Zm0 4.2L8 8v4c0 2.9 1.6 5 4 6.1 2.4-1.1 4-3.2 4-6.1V8l-4-1.8Z',
    network: 'M5 3h4v4H8v4h3v-1h4v4h-4v-1H8v4h1v4H5v-4h1V7H5V3Zm10 0h4v4h-4V3Zm0 14h4v4h-4v-4Z',
    route: 'M6 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm12 12a3 3 0 1 1 0 6 3 3 0 0 1 0-6ZM7 8v3c0 3.3 2.7 6 6 6h2v2h-2a8 8 0 0 1-8-8V8h2Zm8-5h4v4h-2V5h-2V3Z',
  });

  let lastQuery = '';
  let activeRequest = 0;
  let toastTimer = null;

  function createIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', iconPaths[name]);
    svg.append(path);
    return svg;
  }

  function text(value, fallback = '暂无数据') {
    return value === null || value === undefined || value === '' ? fallback : String(value);
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(date);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 3200);
  }

  function setView(view) {
    elements['result-loading'].hidden = view !== 'loading';
    elements['result-error'].hidden = view !== 'error';
    elements['result-content'].hidden = view !== 'content';
    elements['result-shell'].setAttribute('aria-busy', view === 'loading' ? 'true' : 'false');
  }

  function setButtonLoading(loading) {
    elements['lookup-button'].disabled = loading;
    elements['lookup-button'].querySelector('span').textContent = loading ? '查询中…' : '开始查询';
  }

  function signalState(value) {
    if (value === true) return { key: 'yes', label: '命中' };
    if (value === false) return { key: 'no', label: '未命中' };
    return { key: 'unknown', label: '暂无数据' };
  }

  function renderSignals(data) {
    const fragment = document.createDocumentFragment();
    for (const [field, label, description, icon] of signalDefinitions) {
      const state = signalState(data[field]);
      const item = document.createElement('div');
      item.className = 'signal-item';
      item.dataset.state = state.key;
      const iconWrap = document.createElement('span');
      iconWrap.className = 'signal-icon';
      iconWrap.append(createIcon(icon));
      const copy = document.createElement('div');
      const strong = document.createElement('strong');
      const small = document.createElement('small');
      strong.textContent = `${label} · ${state.label}`;
      small.textContent = description;
      copy.append(strong, small);
      item.append(iconWrap, copy);
      fragment.append(item);
    }
    elements['signal-grid'].replaceChildren(fragment);
  }

  function renderEvidence(evidence) {
    const rows = Array.isArray(evidence) ? evidence : [];
    elements['evidence-count'].textContent = `${rows.length} 条`;
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = '当前地址没有可展示的判断证据。';
      elements['evidence-list'].replaceChildren(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const row of rows.slice(0, 20)) {
      const item = document.createElement('div');
      item.className = 'evidence-item';
      const copy = document.createElement('div');
      const strong = document.createElement('strong');
      const small = document.createElement('small');
      const code = document.createElement('code');
      strong.textContent = labels.fields[row.field] || text(row.field, '判断字段');
      small.textContent = `${text(row.source, '未知来源')} · 置信度 ${labels.confidence[row.confidence] || text(row.confidence)}`;
      code.textContent = text(row.value);
      copy.append(strong, small);
      item.append(copy, code);
      fragment.append(item);
    }
    elements['evidence-list'].replaceChildren(fragment);
  }

  function renderSources(data, meta) {
    const sources = [...new Set(Array.isArray(data.sources) ? data.sources : [])];
    const versions = meta?.database_versions || {};
    const fragment = document.createDocumentFragment();
    for (const source of sources) {
      const chip = document.createElement('span');
      chip.className = 'source-chip';
      chip.textContent = versions[source] ? `${source} · ${versions[source]}` : source;
      fragment.append(chip);
    }
    if (sources.length === 0) {
      const chip = document.createElement('span');
      chip.className = 'source-chip';
      chip.textContent = '无外部数据匹配';
      fragment.append(chip);
    }
    elements['source-list'].replaceChildren(fragment);
  }

  function renderResult(data, meta) {
    elements['ip-version'].textContent = data.ip_version ? `IPv${data.ip_version}` : 'IP';
    elements['scope-label'].textContent = labels.scope[data.scope] || text(data.scope);
    elements['result-ip'].textContent = text(data.ip, '--');
    elements['generated-at'].textContent = `北京时间 ${formatTime(meta?.generated_at)}`;
    elements['confidence-value'].textContent = labels.confidence[data.confidence] || text(data.confidence);
    elements['source-count'].textContent = `${Array.isArray(data.sources) ? data.sources.length : 0} 个数据源`;
    elements['location-country'].textContent = data.country_name || data.country_code || '暂无数据';
    elements['location-detail'].textContent = [data.region, data.city].filter(Boolean).join(' · ') || '暂无更细位置';
    elements['asn-value'].textContent = data.asn === null ? '暂无数据' : `AS${data.asn}`;
    elements['asn-org'].textContent = text(data.asn_org);
    elements['network-type'].textContent = labels.network[data.network_type] || text(data.network_type);
    elements['network-note'].textContent = data.network_type === 'unknown' ? '数据不足，暂不判断' : '综合本地规则判断';
    elements['isp-value'].textContent = text(data.isp);
    elements['timezone-value'].textContent = text(data.timezone);
    elements['postcode-value'].textContent = data.postcode ? `邮编 ${data.postcode}` : '暂无邮编数据';
    elements['coordinates-value'].textContent = data.latitude !== null && data.latitude !== undefined
      && data.longitude !== null && data.longitude !== undefined
      && Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude))
      ? `${Number(data.latitude).toFixed(4)}, ${Number(data.longitude).toFixed(4)}`
      : '暂无数据';
    const locationConflict = Array.isArray(data.evidence)
      ? data.evidence.find((item) => item.field === 'location_conflict')
      : null;
    elements['location-alert'].hidden = !locationConflict;
    elements['location-alert'].textContent = locationConflict
      ? '不同数据源对国家与城市的判断不一致，系统已保留国家结论并隐藏冲突的城市坐标。'
      : '';
    renderSignals(data);
    renderEvidence(data.evidence);
    renderSources(data, meta);
    setView('content');
  }

  function showError(error, response) {
    let title = '查询暂时不可用';
    if (response?.status === 400) title = 'IP 地址格式不正确';
    if (response?.status === 429) title = '查询频率过高';
    if (response?.status === 503) title = '数据源尚未就绪';
    elements['error-title'].textContent = title;
    elements['error-message'].textContent = error?.message || '请稍后重新尝试。';
    setView('error');
  }

  async function lookup(query, { updateUrl = true } = {}) {
    const requestNumber = ++activeRequest;
    lastQuery = query.trim();
    elements['input-error'].hidden = true;
    setButtonLoading(true);
    setView('loading');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const endpoint = lastQuery ? `/api/public/lookup?ip=${encodeURIComponent(lastQuery)}` : '/api/public/lookup';
    try {
      const response = await fetch(endpoint, { signal: controller.signal, headers: { accept: 'application/json' } });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const messageByStatus = {
          400: '请输入有效的 IPv4 或 IPv6 地址。',
          429: '查询请求过于频繁，请等待限速窗口结束后重试。',
          503: 'IP 数据库尚未准备完成，请稍后重试。',
        };
        throw Object.assign(new Error(messageByStatus[response.status] || '服务返回异常，请稍后重试。'), { response });
      }
      if (requestNumber !== activeRequest) return;
      renderResult(payload.data, payload.meta);
      if (updateUrl) {
        const target = lastQuery ? `/?ip=${encodeURIComponent(lastQuery)}` : '/';
        history.replaceState(null, '', target);
      }
    } catch (error) {
      if (requestNumber !== activeRequest) return;
      const message = error.name === 'AbortError' ? '查询超过 8 秒，请检查网络后重试。' : error.message;
      showError(new Error(message), error.response);
    } finally {
      clearTimeout(timeout);
      if (requestNumber === activeRequest) setButtonLoading(false);
    }
  }

  elements['lookup-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    lookup(elements['ip-input'].value);
  });

  elements['detect-self'].addEventListener('click', () => {
    elements['ip-input'].value = '';
    lookup('');
  });

  elements['retry-button'].addEventListener('click', () => lookup(lastQuery));

  elements['copy-ip'].addEventListener('click', async () => {
    const value = elements['result-ip'].textContent;
    try {
      await navigator.clipboard.writeText(value);
      showToast('IP 地址已复制');
    } catch {
      showToast('复制失败，请手动选择 IP 地址');
    }
  });

  const initialQuery = new URLSearchParams(location.search).get('ip') || '';
  elements['ip-input'].value = initialQuery;
  lookup(initialQuery, { updateUrl: false });
})();
