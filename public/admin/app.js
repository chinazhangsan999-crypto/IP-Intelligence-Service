(() => {
  'use strict';

  const elements = Object.fromEntries([
    'auth-screen', 'console', 'auth-form', 'metrics-token', 'toggle-token', 'auth-submit',
    'auth-error', 'refresh-button', 'logout-button', 'live-status', 'updated-at',
    'dashboard-error', 'dashboard-error-text', 'retry-button', 'kpi-ready', 'kpi-uptime',
    'kpi-requests', 'kpi-lookups', 'kpi-resolved', 'kpi-slow', 'kpi-memory', 'kpi-heap',
    'kpi-postgres', 'kpi-pool', 'source-count', 'sources-body', 'update-enabled',
    'update-running', 'update-status', 'update-time', 'update-runs', 'routes-body',
    'trend-chart', 'trend-chart-desc', 'trend-empty', 'main-content',
  ].map((id) => [id, document.getElementById(id)]));

  const numberFormat = new Intl.NumberFormat('zh-CN');
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  let token = '';
  let refreshing = false;
  let timer = null;
  const samples = [];
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function formatNumber(value) {
    return numberFormat.format(Number(value || 0));
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes)) return '--';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Number(seconds || 0));
    const days = Math.floor(value / 86400);
    const hours = Math.floor((value % 86400) / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    if (days) return `${days}天 ${hours}小时`;
    if (hours) return `${hours}小时 ${minutes}分钟`;
    return `${minutes}分钟`;
  }

  function formatDate(value) {
    if (!value) return '--';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '--' : dateFormat.format(date);
  }

  function setStatus(kind, label) {
    elements['live-status'].className = `status-pill ${kind}`;
    elements['live-status'].lastChild.textContent = label;
  }

  function showError(message) {
    elements['dashboard-error-text'].textContent = message;
    elements['dashboard-error'].hidden = false;
  }

  function clearError() {
    elements['dashboard-error'].hidden = true;
    elements['dashboard-error-text'].textContent = '';
  }

  async function fetchSnapshot(candidateToken = token) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch('/admin/api/observability', {
        headers: { authorization: `Bearer ${candidateToken}` },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (response.status === 401) {
        const error = new Error('监控访问令牌不正确');
        error.code = 'UNAUTHORIZED';
        throw error;
      }
      if (!response.ok) throw new Error(`状态接口返回 ${response.status}`);
      const payload = await response.json();
      return payload.data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('状态请求超过 8 秒，请检查服务连接');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  function createCell(text, className = '') {
    const cell = document.createElement('td');
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  function renderSources(readiness) {
    const body = elements['sources-body'];
    body.replaceChildren();
    const sources = readiness?.sources || [];
    elements['source-count'].textContent = `${sources.length} 个`;
    if (!sources.length) {
      const row = document.createElement('tr');
      const cell = createCell('暂无数据源状态');
      cell.colSpan = 4;
      row.append(cell);
      body.append(row);
      return;
    }
    for (const source of sources) {
      const row = document.createElement('tr');
      const name = createCell(source.id, 'mono');
      if (source.required) {
        const required = document.createElement('small');
        required.textContent = ' 必需';
        required.title = '该数据源不可用时查询服务停止';
        name.append(required);
      }
      const statusCell = document.createElement('td');
      const status = document.createElement('span');
      status.className = `table-status ${source.status}`;
      status.textContent = { ready: '正常', stale: '已过期', unavailable: '不可用' }[source.status] || source.status;
      statusCell.append(status);
      row.append(name, statusCell, createCell(source.version || '--', 'mono'), createCell(formatDate(source.updated_at)));
      body.append(row);
    }
  }

  function renderRoutes(requests) {
    const body = elements['routes-body'];
    body.replaceChildren();
    const routes = requests?.by_route || [];
    if (!routes.length) {
      const row = document.createElement('tr');
      const cell = createCell('还没有可展示的接口请求');
      cell.colSpan = 5;
      row.append(cell);
      body.append(row);
      return;
    }
    for (const route of routes) {
      const row = document.createElement('tr');
      row.append(
        createCell(route.method, 'mono'),
        createCell(route.route, 'mono'),
        createCell(formatNumber(route.requests), 'mono'),
        createCell(`${route.average_ms} ms`, 'mono'),
        createCell(route.p95_ms === null ? '--' : `≤ ${route.p95_ms} ms`, 'mono'),
      );
      body.append(row);
    }
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function addSvgText(svg, text, x, y, anchor = 'start') {
    const label = svgElement('text', { x, y, 'text-anchor': anchor, class: 'chart-label' });
    label.textContent = text;
    svg.append(label);
  }

  function renderTrend() {
    const svg = elements['trend-chart'];
    const persistent = [...svg.querySelectorAll('title, desc')];
    svg.replaceChildren(...persistent);
    if (samples.length < 2) {
      elements['trend-empty'].hidden = false;
      return;
    }
    const points = [];
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];
      const minutes = Math.max((current.time - previous.time) / 60_000, 1 / 60);
      points.push({
        time: current.time,
        requests: Math.max(0, current.requests - previous.requests) / minutes,
        resolved: Math.max(0, current.resolved - previous.resolved) / minutes,
      });
    }
    elements['trend-empty'].hidden = true;
    const width = 900;
    const height = 250;
    const padding = { left: 48, right: 20, top: 18, bottom: 34 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const maxValue = Math.max(1, ...points.flatMap((point) => [point.requests, point.resolved]));

    for (let index = 0; index <= 4; index += 1) {
      const y = padding.top + (innerHeight * index) / 4;
      svg.append(svgElement('line', { x1: padding.left, x2: width - padding.right, y1: y, y2: y, class: 'chart-grid' }));
      addSvgText(svg, (maxValue * (1 - index / 4)).toFixed(maxValue < 10 ? 1 : 0), padding.left - 8, y + 4, 'end');
    }

    const xFor = (index) => padding.left + (points.length === 1 ? innerWidth / 2 : (innerWidth * index) / (points.length - 1));
    const yFor = (value) => padding.top + innerHeight - (value / maxValue) * innerHeight;
    const series = [
      { key: 'requests', color: '#2563eb', label: '请求/分钟' },
      { key: 'resolved', color: '#0891b2', label: '解析IP/分钟' },
    ];
    for (const item of series) {
      const coordinates = points.map((point, index) => `${xFor(index)},${yFor(point[item.key])}`).join(' ');
      svg.append(svgElement('polyline', { points: coordinates, class: 'chart-line', stroke: item.color }));
      points.forEach((point, index) => {
        const dot = svgElement('circle', { cx: xFor(index), cy: yFor(point[item.key]), r: 4, fill: item.color, class: 'chart-dot', tabindex: 0 });
        const title = svgElement('title');
        title.textContent = `${dateFormat.format(point.time)} · ${item.label} ${point[item.key].toFixed(1)}`;
        dot.append(title);
        svg.append(dot);
      });
    }
    const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    labelIndexes.forEach((index) => addSvgText(svg, dateFormat.format(points[index].time).slice(6, 11), xFor(index), height - 10, index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'));
    elements['trend-chart-desc'].textContent = `最近 ${points.length} 个采样区间，请求峰值 ${Math.max(...points.map((point) => point.requests)).toFixed(1)} 每分钟，解析 IP 峰值 ${Math.max(...points.map((point) => point.resolved)).toFixed(1)} 每分钟。`;
  }

  function render(snapshot) {
    const ready = snapshot.readiness?.required_sources_ready === true;
    elements['kpi-ready'].textContent = ready ? '运行正常' : '服务降级';
    elements['kpi-uptime'].textContent = `运行时间 ${formatDuration(snapshot.uptime_seconds)}`;
    elements['kpi-requests'].textContent = formatNumber(snapshot.requests?.total);
    elements['kpi-lookups'].textContent = formatNumber(snapshot.lookups?.ips?.requested);
    elements['kpi-resolved'].textContent = `已解析 ${formatNumber(snapshot.lookups?.ips?.resolved)}`;
    elements['kpi-slow'].textContent = formatNumber(snapshot.requests?.slow);
    elements['kpi-memory'].textContent = formatBytes(snapshot.process?.resident_memory_bytes);
    elements['kpi-heap'].textContent = `堆内存 ${formatBytes(snapshot.process?.heap_used_bytes)}`;
    elements['kpi-postgres'].textContent = snapshot.postgres ? '已连接' : '未配置';
    elements['kpi-pool'].textContent = snapshot.postgres
      ? `总连接 ${snapshot.postgres.total_connections} · 等待 ${snapshot.postgres.waiting_requests}`
      : '开发模式可不启用';
    setStatus(ready ? 'good' : 'bad', ready ? '数据源已就绪' : '服务处于降级');
    elements['updated-at'].dateTime = new Date().toISOString();
    elements['updated-at'].textContent = dateFormat.format(new Date());

    const scheduler = snapshot.updates?.scheduler;
    elements['update-enabled'].textContent = scheduler?.enabled ? '已启用' : '未启用';
    elements['update-running'].textContent = scheduler?.running ? '更新中' : '空闲';
    elements['update-status'].textContent = ({ succeeded: '成功', failed: '失败', skipped: '已跳过' })[scheduler?.last_run?.status] || '尚未执行';
    elements['update-time'].textContent = formatDate(scheduler?.last_run?.completed_at);
    const updateRuns = snapshot.updates?.runs || {};
    elements['update-runs'].textContent = `成功 ${formatNumber(updateRuns.succeeded)} · 失败 ${formatNumber(updateRuns.failed)}`;

    renderSources(snapshot.readiness);
    renderRoutes(snapshot.requests);
    samples.push({
      time: Date.now(),
      requests: Number(snapshot.requests?.total || 0),
      resolved: Number(snapshot.lookups?.ips?.resolved || 0),
    });
    if (samples.length > 60) samples.shift();
    renderTrend();
  }

  async function refresh({ initial = false } = {}) {
    if (!token || refreshing) return;
    refreshing = true;
    elements['refresh-button'].disabled = true;
    if (!initial) setStatus('neutral', '正在刷新');
    try {
      const snapshot = await fetchSnapshot();
      clearError();
      render(snapshot);
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        logout();
        elements['auth-error'].textContent = error.message;
        elements['auth-error'].hidden = false;
        elements['metrics-token'].focus();
      } else {
        setStatus('bad', '连接异常');
        showError(error.message || '无法加载运行状态，请稍后重试');
      }
    } finally {
      refreshing = false;
      elements['refresh-button'].disabled = false;
    }
  }

  function startPolling() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, 15_000);
  }

  function logout() {
    token = '';
    samples.splice(0);
    clearInterval(timer);
    timer = null;
    elements.console.hidden = true;
    elements['auth-screen'].hidden = false;
    elements['metrics-token'].value = '';
    elements['auth-submit'].disabled = false;
  }

  elements['auth-form'].addEventListener('submit', async (event) => {
    event.preventDefault();
    const candidate = elements['metrics-token'].value;
    elements['auth-error'].hidden = true;
    if (candidate.length < 32) {
      elements['auth-error'].textContent = '请输入至少 32 个字符的监控访问令牌';
      elements['auth-error'].hidden = false;
      elements['metrics-token'].focus();
      return;
    }
    elements['auth-submit'].disabled = true;
    elements['auth-submit'].textContent = '正在验证...';
    try {
      const snapshot = await fetchSnapshot(candidate);
      token = candidate;
      elements['metrics-token'].value = '';
      elements['auth-screen'].hidden = true;
      elements.console.hidden = false;
      render(snapshot);
      startPolling();
      window.scrollTo({ top: 0, left: 0 });
      elements['main-content']?.focus({ preventScroll: true });
    } catch (error) {
      elements['auth-error'].textContent = error.message || '验证失败，请稍后重试';
      elements['auth-error'].hidden = false;
      elements['metrics-token'].focus();
    } finally {
      elements['auth-submit'].disabled = false;
      elements['auth-submit'].textContent = '验证并进入';
    }
  });

  elements['toggle-token'].addEventListener('click', () => {
    const reveal = elements['metrics-token'].type === 'password';
    elements['metrics-token'].type = reveal ? 'text' : 'password';
    elements['toggle-token'].setAttribute('aria-pressed', String(reveal));
    elements['toggle-token'].setAttribute('aria-label', reveal ? '隐藏令牌' : '显示令牌');
  });
  elements['refresh-button'].addEventListener('click', () => refresh());
  elements['retry-button'].addEventListener('click', () => refresh());
  elements['logout-button'].addEventListener('click', logout);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && token) refresh();
  });
})();
