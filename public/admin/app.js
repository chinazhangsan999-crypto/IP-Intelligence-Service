(() => {
  'use strict';

  const elements = Object.fromEntries([
    'auth-screen', 'console', 'auth-form', 'login-username', 'login-password', 'auth-submit',
    'auth-error', 'refresh-button', 'logout-button', 'live-status', 'updated-at',
    'dashboard-error', 'dashboard-error-text', 'retry-button', 'kpi-ready', 'kpi-uptime',
    'kpi-requests', 'kpi-lookups', 'kpi-resolved', 'kpi-slow', 'kpi-memory', 'kpi-heap',
    'kpi-postgres', 'kpi-pool', 'source-count', 'sources-body', 'update-enabled',
    'update-running', 'update-status', 'update-time', 'update-runs', 'routes-body',
    'trend-chart', 'trend-chart-desc', 'trend-empty', 'main-content', 'account-form',
    'account-username', 'current-password', 'new-password', 'confirm-password',
    'account-error', 'account-success', 'account-submit', 'current-account',
    'client-count', 'client-form', 'client-id', 'client-name', 'client-limit', 'client-submit',
    'client-error', 'clients-body', 'rule-count', 'rule-form', 'rule-source-id', 'rule-name', 'rule-match-type',
    'rule-match-value', 'rule-network-type', 'rule-confidence', 'rule-priority', 'rule-hosting',
    'rule-mobile', 'rule-submit', 'rule-cancel', 'rule-error', 'rules-body', 'jobs-body', 'job-count',
    'database-group-count', 'database-file-count', 'database-ready-count', 'database-issue-count',
    'database-list', 'check-all-sources-button', 'update-all-sources-button', 'force-download-all-button',
    'source-dialog', 'source-config-form', 'source-config-id', 'source-config-name',
    'source-config-interval', 'source-config-enabled', 'source-config-auto', 'source-config-requirement', 'source-config-error',
    'source-config-submit', 'source-config-cancel', 'source-dialog-close',
    'source-credentials', 'source-credentials-fields',
    'download-dialog', 'download-form', 'download-source-id', 'download-dialog-copy', 'download-preflight',
    'download-confirm', 'download-cancel', 'download-dialog-close',
    'audit-count', 'audit-body', 'secret-dialog', 'secret-dialog-title', 'generated-secret', 'copy-secret', 'admin-toast',
  ].map((id) => [id, document.getElementById(id)]));

  const numberFormat = new Intl.NumberFormat('zh-CN');
  const dateFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  let authenticated = false;
  let csrfToken = '';
  let refreshing = false;
  let timer = null;
  let toastTimer = null;
  const samples = [];
  let dataSourceUnits = [];
  let classificationRules = [];
  let editingRuleId = null;
  let sourceCredentialFields = [];
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

  function jobResultText(job) {
    if (job.status === 'running') return '任务执行中';
    if (job.error_message) return job.error_message;
    const results = job.details?.results || {};
    const lines = Object.entries(results).map(([id, entry]) => {
      if (entry.status === 'failed') return `${id}：失败`;
      const result = entry.result || {};
      if (result.updated === true) return `${id}：已下载并安装`;
      if (result.status === 'current') return `${id}：内容相同 / 已是最新`;
      if (result.status === 'not_due' || result.status === 'deferred') return `${id}：按周期跳过`;
      return `${id}：检查完成`;
    });
    const validation = job.details?.validation;
    if (validation) {
      lines.push(validation.passed
        ? `固定样本校验：通过（${validation.resolved_count}/${validation.sample_count}）`
        : '固定样本校验：未通过');
    }
    return lines.join('；') || '--';
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

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(path, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        ...options,
      });
      if (response.status === 401) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload.message || '登录状态已失效，请重新登录');
        error.code = 'UNAUTHORIZED';
        throw error;
      }
      const payload = await response.json();
      if (!response.ok) {
        const error = new Error(payload.message || `请求返回 ${response.status}`);
        error.code = payload.code;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超过 8 秒，请检查服务连接');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchSnapshot() {
    return (await request('/admin/api/observability')).data;
  }

  async function fetchManagement() {
    return (await request('/admin/api/management')).data;
  }

  async function postManagement(path, body = {}) {
    return request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify(body),
    });
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    elements['admin-toast'].textContent = message;
    elements['admin-toast'].hidden = false;
    toastTimer = setTimeout(() => { elements['admin-toast'].hidden = true; }, 3200);
  }

  function showSecret(secret, title) {
    elements['secret-dialog-title'].textContent = title;
    elements['generated-secret'].value = secret;
    elements['secret-dialog'].showModal();
    elements['generated-secret'].focus();
    elements['generated-secret'].select();
  }

  function applySession(data) {
    authenticated = true;
    csrfToken = data.csrf_token || csrfToken;
    elements['account-username'].value = data.user.username;
    elements['current-account'].textContent = data.user.username;
    elements['auth-screen'].hidden = true;
    elements.console.hidden = false;
    syncNavigation();
  }

  function syncNavigation() {
    const hash = window.location.hash || '#overview';
    const systemHashes = new Set(['#system-management', '#database-center', '#rules', '#data-operations', '#account']);
    for (const link of document.querySelectorAll('.console-nav a, .section-nav a')) {
      const target = link.getAttribute('href');
      const active = target === hash || (target === '#system-management' && systemHashes.has(hash));
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }

  function createCell(text, className = '') {
    const cell = document.createElement('td');
    cell.textContent = text;
    if (className) cell.className = className;
    return cell;
  }

  function appendEmptyRow(body, message, columns) {
    const row = document.createElement('tr');
    const cell = createCell(message);
    cell.colSpan = columns;
    row.append(cell);
    body.append(row);
  }

  function createStatus(value, labels = {}) {
    const status = document.createElement('span');
    status.className = `table-status ${['active', 'ready', 'succeeded', 'success'].includes(value) ? 'ready' : ['running', 'stale'].includes(value) ? 'stale' : 'unavailable'}`;
    status.textContent = labels[value] || value || '--';
    return status;
  }

  function actionButton(label, action, id, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `table-button${danger ? ' danger' : ''}`;
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.id = id;
    return button;
  }

  function safeExternalLink(url, label) {
    const link = document.createElement('a');
    link.className = 'source-link';
    link.textContent = label || url;
    try {
      const target = new URL(url);
      if (target.protocol !== 'https:') throw new Error('invalid protocol');
      link.href = target.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = target.href;
    } catch {
      link.removeAttribute('href');
    }
    return link;
  }

  function renderDataSources(units, updateState = null) {
    dataSourceUnits = units || [];
    const selectedSource = elements['rule-source-id'].value;
    elements['rule-source-id'].replaceChildren(new Option('通用人工规则', ''));
    for (const unit of dataSourceUnits) {
      elements['rule-source-id'].append(new Option(unit.config?.display_name || unit.displayName, unit.id));
    }
    elements['rule-source-id'].value = dataSourceUnits.some((unit) => unit.id === selectedSource) ? selectedSource : '';
    const members = dataSourceUnits.flatMap((unit) => unit.members || []);
    const ready = members.filter((member) => member.state?.status === 'ready').length;
    elements['database-group-count'].textContent = formatNumber(dataSourceUnits.length);
    elements['database-file-count'].textContent = formatNumber(members.length);
    elements['database-ready-count'].textContent = formatNumber(ready);
    elements['database-issue-count'].textContent = formatNumber(members.length - ready);
    elements['database-list'].replaceChildren();
    if (!dataSourceUnits.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = '暂未读取到数据库配置，请刷新状态。';
      elements['database-list'].append(empty);
      return;
    }
    for (const unit of dataSourceUnits) {
      const card = document.createElement('article');
      card.className = 'database-card';
      const header = document.createElement('div');
      header.className = 'database-card-header';
      const heading = document.createElement('div');
      const title = document.createElement('h3');
      title.textContent = unit.config?.display_name || unit.displayName;
      const description = document.createElement('p');
      description.textContent = unit.description;
      heading.append(title, description);
      const actions = document.createElement('div');
      actions.className = 'action-group database-actions';
      const disabled = unit.config?.enabled === false || updateState?.running === true;
      const download = actionButton('下载', 'download-source', unit.id);
      const edit = actionButton('编辑', 'edit-source', unit.id);
      const rules = actionButton('规则', 'rules-source', unit.id);
      const update = actionButton('更新', 'update-source', unit.id);
      download.title = '强制重新下载到服务器，校验成功后安装';
      update.title = '检查并更新此数据库组';
      download.disabled = disabled;
      update.disabled = disabled;
      rules.title = '新增或查看与此数据源关联的人工判断规则';
      actions.append(download, edit, rules, update);
      header.append(heading, actions);

      const meta = document.createElement('div');
      meta.className = 'database-meta';
      const enabled = createStatus(unit.config?.enabled === false ? 'disabled' : 'active', { active: '已启用', disabled: '已停用' });
      const auto = document.createElement('span');
      auto.className = 'database-policy';
      auto.textContent = unit.config?.auto_update_enabled
        ? `自动更新 · 每 ${formatNumber(unit.config.interval_hours)} 小时`
        : '仅手动更新';
      const lastRun = document.createElement('span');
      lastRun.className = 'database-policy';
      lastRun.textContent = unit.config?.last_update_at
        ? `组更新：${unit.config.last_update_status === 'failed' ? '失败' : '成功'} · ${formatDate(unit.config.last_update_at)}`
        : '尚无组更新记录';
      if (unit.config?.last_error) lastRun.title = unit.config.last_error;
      meta.append(enabled, auto, lastRun);
      if (unit.config?.last_error) {
        const error = document.createElement('p');
        error.className = 'database-error';
        error.textContent = `最近错误：${unit.config.last_error}`;
        meta.append(error);
      }

      const tableWrap = document.createElement('div');
      tableWrap.className = 'table-scroll';
      const table = document.createElement('table');
      const thead = document.createElement('thead');
      const headRow = document.createElement('tr');
      for (const label of ['数据文件', '类型', '状态 / 版本', '下载与校验入口', '最近更新']) {
        const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; headRow.append(th);
      }
      thead.append(headRow);
      const tbody = document.createElement('tbody');
      for (const member of unit.members || []) {
        const row = document.createElement('tr');
        const identity = document.createElement('td');
        const memberName = document.createElement('span'); memberName.className = 'row-title'; memberName.textContent = member.name;
        const memberMeta = document.createElement('span'); memberMeta.className = 'row-meta mono'; memberMeta.textContent = `${member.id} · ${member.license || '许可证未注明'}`;
        identity.append(memberName, memberMeta);
        const stateCell = document.createElement('td');
        stateCell.append(createStatus(member.state?.status || 'unavailable', { ready: '正常', stale: '已过期', unavailable: '不可用' }));
        const version = document.createElement('span'); version.className = 'row-meta mono'; version.textContent = member.state?.version || '暂无版本'; stateCell.append(version);
        if (member.state?.last_error) {
          const error = document.createElement('span');
          error.className = 'row-error';
          error.textContent = `错误：${member.state.last_error}`;
          stateCell.append(error);
        }
        const linksCell = document.createElement('td');
        const links = document.createElement('div'); links.className = 'source-links';
        const urls = member.downloadUrls || (member.downloadUrl ? [member.downloadUrl] : []);
        urls.forEach((url, index) => links.append(safeExternalLink(url, urls.length > 1 ? `下载入口 ${index + 1}` : '下载入口')));
        if (member.checksumUrl) links.append(safeExternalLink(member.checksumUrl, '校验入口'));
        if (member.homepageUrl) links.append(safeExternalLink(member.homepageUrl, '来源说明'));
        if (!links.childElementCount) links.textContent = '需先完成来源要求，再由服务器生成';
        linksCell.append(links);
        row.append(identity, createCell(member.kind || '--'), stateCell, linksCell, createCell(formatDate(member.state?.updated_at)));
        tbody.append(row);
      }
      table.append(thead, tbody); tableWrap.append(table);
      card.append(header, meta, tableWrap);
      elements['database-list'].append(card);
    }
  }

  function renderManagement(data) {
    const sourceNames = new Map((data.data_sources || []).map((unit) => [unit.id, unit.config?.display_name || unit.displayName]));
    const usage = new Map((data.usage_24h || []).map((row) => [row.client_id, row]));
    const clients = data.clients || [];
    elements['client-count'].textContent = `${clients.length} 个`;
    elements['clients-body'].replaceChildren();
    if (!clients.length) appendEmptyRow(elements['clients-body'], '尚未创建导航站接入方。', 6);
    for (const client of clients) {
      const row = document.createElement('tr');
      const identity = document.createElement('td');
      const title = document.createElement('span');
      title.className = 'row-title';
      title.textContent = client.display_name;
      const meta = document.createElement('span');
      meta.className = 'row-meta mono';
      meta.textContent = `${client.client_id} · 密钥版本 ${client.secret_version}`;
      identity.append(title, meta);
      const statusCell = document.createElement('td');
      statusCell.append(createStatus(client.status, { active: '启用', disabled: '已暂停' }));
      const clientUsage = usage.get(client.client_id) || {};
      const actions = document.createElement('td');
      const group = document.createElement('div');
      group.className = 'action-group';
      group.append(
        actionButton('轮换密钥', 'rotate-client', client.client_id),
        actionButton(client.status === 'active' ? '暂停' : '启用', 'toggle-client', client.client_id, client.status === 'active'),
      );
      actions.append(group);
      row.append(
        identity,
        statusCell,
        createCell(`${formatNumber(clientUsage.request_count)} / ${formatNumber(clientUsage.ip_count)} / ${formatNumber(clientUsage.error_count)}`, 'mono'),
        createCell(`${formatNumber(client.rate_limit_per_minute)} / 分钟`, 'mono'),
        createCell(formatDate(client.last_used_at)),
        actions,
      );
      row.dataset.status = client.status;
      elements['clients-body'].append(row);
    }

    const rules = data.classification_rules || [];
    classificationRules = rules;
    elements['rule-count'].textContent = `${rules.length} 条`;
    elements['rules-body'].replaceChildren();
    if (!rules.length) appendEmptyRow(elements['rules-body'], '尚未添加数据库判断规则，当前使用内置规则文件。', 7);
    for (const rule of rules) {
      const row = document.createElement('tr');
      const identity = document.createElement('td');
      const title = document.createElement('span');
      title.className = 'row-title';
      title.textContent = rule.name;
      const meta = document.createElement('span');
      meta.className = 'row-meta';
      meta.textContent = `置信度 ${rule.confidence}`;
      identity.append(title, meta);
      const statusCell = document.createElement('td');
      statusCell.append(createStatus(rule.enabled ? 'active' : 'disabled', { active: '启用', disabled: '停用' }));
      const actions = document.createElement('td');
      actions.append(actionButton('编辑', 'edit-rule', String(rule.id)), actionButton(rule.enabled ? '停用' : '启用', 'toggle-rule', String(rule.id), rule.enabled));
      row.append(identity, createCell(sourceNames.get(rule.source_id) || rule.source_id || '通用人工规则'), createCell(`${rule.match_type}: ${rule.match_value}`, 'mono'), createCell(rule.network_type), createCell(formatNumber(rule.priority), 'mono'), statusCell, actions);
      row.dataset.enabled = String(rule.enabled);
      elements['rules-body'].append(row);
    }

    const jobs = data.update_jobs || [];
    elements['job-count'].textContent = `${jobs.length} 条`;
    elements['jobs-body'].replaceChildren();
    if (!jobs.length) appendEmptyRow(elements['jobs-body'], '暂无数据更新任务记录。', 6);
    for (const job of jobs) {
      const row = document.createElement('tr');
      const statusCell = document.createElement('td');
      statusCell.append(createStatus(job.status, { running: '执行中', succeeded: '成功', failed: '失败' }));
      row.append(createCell(job.source_id, 'mono'), statusCell, createCell(job.target_version || '--', 'mono'), createCell(formatDate(job.started_at)), createCell(formatDate(job.completed_at)), createCell(jobResultText(job), 'job-result'));
      elements['jobs-body'].append(row);
    }

    const audits = data.audit_logs || [];
    elements['audit-count'].textContent = `${audits.length} 条`;
    elements['audit-body'].replaceChildren();
    if (!audits.length) appendEmptyRow(elements['audit-body'], '暂无审计记录。', 5);
    for (const audit of audits) {
      const row = document.createElement('tr');
      const outcome = document.createElement('td');
      outcome.append(createStatus(audit.outcome, { success: '成功', rejected: '拒绝', failure: '失败' }));
      row.append(createCell(formatDate(audit.created_at)), createCell(audit.event_type, 'mono'), outcome, createCell(audit.client_id || '系统'), createCell(audit.request_id || '--', 'mono'));
      elements['audit-body'].append(row);
    }
    renderDataSources(data.data_sources || [], data.update_state);
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
    if (!authenticated || refreshing) return;
    refreshing = true;
    elements['refresh-button'].disabled = true;
    if (!initial) setStatus('neutral', '正在刷新');
    try {
      const [snapshot, management] = await Promise.all([fetchSnapshot(), fetchManagement()]);
      clearError();
      render(snapshot);
      renderManagement(management);
    } catch (error) {
      if (error.code === 'UNAUTHORIZED') {
        showLogin();
        elements['auth-error'].textContent = error.message;
        elements['auth-error'].hidden = false;
        elements['login-username'].focus();
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

  function showLogin() {
    authenticated = false;
    csrfToken = '';
    samples.splice(0);
    clearInterval(timer);
    timer = null;
    elements.console.hidden = true;
    elements['auth-screen'].hidden = false;
    elements['login-password'].value = '';
    elements['auth-submit'].disabled = false;
  }

  async function logout() {
    try {
      if (authenticated && csrfToken) {
        await request('/admin/api/logout', { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
      }
    } catch (_) {
      // 本地仍退出，服务端会话最多在 12 小时后过期。
    }
    showLogin();
  }

  elements['auth-form'].addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = elements['login-username'].value.trim();
    const password = elements['login-password'].value;
    elements['auth-error'].hidden = true;
    if (!username || !password) {
      elements['auth-error'].textContent = '请输入管理账号和密码';
      elements['auth-error'].hidden = false;
      (username ? elements['login-password'] : elements['login-username']).focus();
      return;
    }
    elements['auth-submit'].disabled = true;
    elements['auth-submit'].textContent = '正在验证…';
    try {
      const login = await request('/admin/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      applySession(login.data);
      elements['login-password'].value = '';
      const [snapshot, management] = await Promise.all([fetchSnapshot(), fetchManagement()]);
      render(snapshot);
      renderManagement(management);
      startPolling();
      window.scrollTo({ top: 0, left: 0 });
      elements['main-content']?.focus({ preventScroll: true });
    } catch (error) {
      elements['auth-error'].textContent = error.message || '验证失败，请稍后重试';
      elements['auth-error'].hidden = false;
      elements['login-password'].focus();
    } finally {
      elements['auth-submit'].disabled = false;
      elements['auth-submit'].textContent = '验证并进入';
    }
  });

  document.querySelectorAll('[data-password-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(reveal));
      button.setAttribute('aria-label', reveal ? '隐藏密码' : '显示密码');
    });
  });

  elements['account-form'].addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = elements['account-username'].value.trim();
    const currentPassword = elements['current-password'].value;
    const newPassword = elements['new-password'].value;
    const confirmPassword = elements['confirm-password'].value;
    elements['account-error'].hidden = true;
    elements['account-success'].hidden = true;
    if (!currentPassword) {
      elements['account-error'].textContent = '请输入当前密码确认身份';
      elements['account-error'].hidden = false;
      elements['current-password'].focus();
      return;
    }
    if (newPassword && newPassword.length < 12) {
      elements['account-error'].textContent = '新密码至少需要 12 个字符';
      elements['account-error'].hidden = false;
      elements['new-password'].focus();
      return;
    }
    if (newPassword !== confirmPassword) {
      elements['account-error'].textContent = '两次输入的新密码不一致';
      elements['account-error'].hidden = false;
      elements['confirm-password'].focus();
      return;
    }
    elements['account-submit'].disabled = true;
    elements['account-submit'].textContent = '正在保存…';
    try {
      await request('/admin/api/account', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ current_password: currentPassword, username, new_password: newPassword }),
      });
      elements['account-success'].textContent = '账户设置已保存，请使用新账号和密码重新登录。';
      elements['account-success'].hidden = false;
      setTimeout(() => {
        showLogin();
        elements['login-username'].value = username;
        elements['login-password'].focus();
      }, 1200);
    } catch (error) {
      elements['account-error'].textContent = error.message || '保存失败，请稍后重试';
      elements['account-error'].hidden = false;
    } finally {
      elements['account-submit'].disabled = false;
      elements['account-submit'].textContent = '保存账户设置';
    }
  });

  elements['client-form'].addEventListener('submit', async (event) => {
    event.preventDefault();
    elements['client-error'].hidden = true;
    elements['client-submit'].disabled = true;
    elements['client-submit'].textContent = '正在创建…';
    try {
      const response = await postManagement('/admin/api/clients', {
        client_id: elements['client-id'].value.trim(),
        display_name: elements['client-name'].value.trim(),
        rate_limit_per_minute: Number(elements['client-limit'].value),
      });
      showSecret(response.data.secret, '保存新接入密钥');
      elements['client-form'].reset();
      elements['client-limit'].value = '600';
      renderManagement(await fetchManagement());
    } catch (error) {
      elements['client-error'].textContent = error.message || '创建失败，请检查输入后重试';
      elements['client-error'].hidden = false;
    } finally {
      elements['client-submit'].disabled = false;
      elements['client-submit'].textContent = '创建接入方';
    }
  });

  elements['clients-body'].addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const clientId = button.dataset.id;
    const action = button.dataset.action;
    const currentStatus = button.closest('tr')?.dataset.status;
    if (action === 'rotate-client' && !window.confirm(`轮换 ${clientId} 的密钥？旧密钥会立即失效。`)) return;
    if (action === 'toggle-client' && currentStatus === 'active' && !window.confirm(`暂停 ${clientId}？该接入方将无法继续查询。`)) return;
    button.disabled = true;
    try {
      const response = action === 'rotate-client'
        ? await postManagement(`/admin/api/clients/${encodeURIComponent(clientId)}/rotate`)
        : await postManagement(`/admin/api/clients/${encodeURIComponent(clientId)}/status`, { status: currentStatus === 'active' ? 'disabled' : 'active' });
      if (response.data.secret) showSecret(response.data.secret, '保存轮换后的密钥');
      else showToast(currentStatus === 'active' ? '接入方已暂停' : '接入方已启用');
      renderManagement(await fetchManagement());
    } catch (error) {
      showError(error.message || '操作失败，请稍后重试');
    } finally {
      button.disabled = false;
    }
  });

  elements['rule-form'].addEventListener('submit', async (event) => {
    event.preventDefault();
    const wasEditing = Boolean(editingRuleId);
    elements['rule-error'].hidden = true;
    elements['rule-submit'].disabled = true;
    elements['rule-submit'].textContent = '正在保存…';
    try {
      await postManagement(editingRuleId ? `/admin/api/classification-rules/${editingRuleId}` : '/admin/api/classification-rules', {
        name: elements['rule-name'].value.trim(),
        source_id: elements['rule-source-id'].value || null,
        match_type: elements['rule-match-type'].value,
        match_value: elements['rule-match-value'].value.trim(),
        network_type: elements['rule-network-type'].value,
        confidence: elements['rule-confidence'].value,
        priority: Number(elements['rule-priority'].value),
        flags: {
          is_hosting: elements['rule-hosting'].checked,
          is_mobile: elements['rule-mobile'].checked,
        },
        enabled: true,
      });
      resetRuleForm();
      showToast(wasEditing ? '分类规则已更新并立即生效' : '分类规则已保存并立即生效');
      renderManagement(await fetchManagement());
    } catch (error) {
      elements['rule-error'].textContent = error.message || '规则保存失败，请检查匹配值';
      elements['rule-error'].hidden = false;
    } finally {
      elements['rule-submit'].disabled = false;
      elements['rule-submit'].textContent = editingRuleId ? '保存规则修改' : '新增分类规则';
    }
  });

  function resetRuleForm() {
    editingRuleId = null;
    elements['rule-form'].reset();
    elements['rule-priority'].value = '100';
    elements['rule-submit'].textContent = '新增分类规则';
    elements['rule-cancel'].hidden = true;
  }

  elements['rule-cancel'].addEventListener('click', resetRuleForm);

  elements['rules-body'].addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'edit-rule') {
      const rule = classificationRules.find((item) => String(item.id) === button.dataset.id);
      if (!rule) return;
      editingRuleId = rule.id;
      elements['rule-source-id'].value = rule.source_id || '';
      elements['rule-name'].value = rule.name;
      elements['rule-match-type'].value = rule.match_type;
      elements['rule-match-value'].value = rule.match_value;
      elements['rule-network-type'].value = rule.network_type;
      elements['rule-confidence'].value = rule.confidence;
      elements['rule-priority'].value = String(rule.priority);
      elements['rule-hosting'].checked = rule.flags?.is_hosting === true;
      elements['rule-mobile'].checked = rule.flags?.is_mobile === true;
      elements['rule-submit'].textContent = '保存规则修改';
      elements['rule-cancel'].hidden = false;
      elements['rule-name'].focus();
      return;
    }
    if (button.dataset.action !== 'toggle-rule') return;
    const enabled = button.closest('tr')?.dataset.enabled === 'true';
    button.disabled = true;
    try {
      await postManagement(`/admin/api/classification-rules/${button.dataset.id}/status`, { enabled: !enabled });
      showToast(enabled ? '判断规则已停用' : '判断规则已启用');
      renderManagement(await fetchManagement());
    } catch (error) {
      showError(error.message || '规则状态更新失败');
    } finally {
      button.disabled = false;
    }
  });

  async function startDataUpdate(path, button, pendingLabel) {
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = pendingLabel;
    try {
      await postManagement(path);
      showToast('数据更新任务已启动，可在更新任务中查看结果');
      setTimeout(() => refresh(), 1200);
    } catch (error) {
      showError(error.message || '无法启动数据更新任务，请稍后重试');
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  elements['check-all-sources-button'].addEventListener('click', async () => {
    const button = elements['check-all-sources-button'];
    button.disabled = true;
    button.textContent = '正在刷新…';
    try {
      renderDataSources((await postManagement('/admin/api/data-sources/check-all')).data.data_sources || []);
      showToast('数据库状态已刷新');
    } catch (error) {
      showError(error.message || '无法刷新数据库状态');
    } finally {
      button.disabled = false;
      button.textContent = '刷新数据状态';
    }
  });

  elements['update-all-sources-button'].addEventListener('click', () => startDataUpdate(
    '/admin/api/data-sources/update-all', elements['update-all-sources-button'], '正在启动…',
  ));

  elements['force-download-all-button'].addEventListener('click', async () => {
    const button = elements['force-download-all-button'];
    button.disabled = true;
    button.textContent = '正在预检…';
    try {
      const response = await request('/admin/api/data-sources/force-download-preflight');
      const preflight = response.data;
      elements['download-source-id'].value = '__all__';
      elements['download-dialog-copy'].textContent = '系统将顺序强制重新下载全部已启用数据库。每组校验成功后才替换旧文件，完成后自动执行固定 IP 样本查询。';
      elements['download-preflight'].replaceChildren();
      const summary = document.createElement('strong');
      summary.textContent = `预计处理 ${preflight.enabled_group_count} 个数据库组、${preflight.enabled_file_count} 个数据文件`;
      const storage = document.createElement('span');
      storage.textContent = `当前数据 ${formatBytes(preflight.current_data_bytes)} · 可用空间 ${formatBytes(preflight.free_bytes)} · 预计临时空间 ${formatBytes(preflight.estimated_temporary_bytes)}`;
      elements['download-preflight'].append(summary, storage);
      for (const warning of preflight.warnings || []) {
        const line = document.createElement('span');
        line.textContent = warning;
        elements['download-preflight'].append(line);
      }
      if (preflight.disabled_groups?.length) {
        const disabled = document.createElement('span');
        disabled.textContent = `已停用且不会下载：${preflight.disabled_groups.join('、')}`;
        elements['download-preflight'].append(disabled);
      }
      const enoughDisk = preflight.enough_disk !== false;
      if (!enoughDisk) {
        const danger = document.createElement('span');
        danger.className = 'preflight-danger';
        danger.textContent = '可用磁盘空间不足，已禁止启动强制下载。';
        elements['download-preflight'].append(danger);
      }
      elements['download-preflight'].hidden = false;
      elements['download-confirm'].disabled = !enoughDisk;
      elements['download-confirm'].textContent = '确认强制重新下载全部';
      elements['download-dialog'].showModal();
      elements['download-confirm'].focus();
    } catch (error) {
      showError(error.message || '无法完成下载前检查');
    } finally {
      button.disabled = false;
      button.textContent = '一键下载全部';
    }
  });

  function closeSourceDialog() { elements['source-dialog'].close(); }
  elements['source-dialog-close'].addEventListener('click', closeSourceDialog);
  elements['source-config-cancel'].addEventListener('click', closeSourceDialog);
  function closeDownloadDialog() { elements['download-dialog'].close(); }
  elements['download-dialog-close'].addEventListener('click', closeDownloadDialog);
  elements['download-cancel'].addEventListener('click', closeDownloadDialog);

  elements['database-list'].addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const unit = dataSourceUnits.find((item) => item.id === button.dataset.id);
    if (!unit) return;
    if (button.dataset.action === 'edit-source') {
      elements['source-config-id'].value = unit.id;
      elements['source-config-name'].value = unit.config?.display_name || unit.displayName;
      elements['source-config-interval'].value = String(unit.config?.interval_hours || unit.defaults.interval_hours);
      elements['source-config-enabled'].checked = unit.config?.enabled !== false;
      elements['source-config-auto'].checked = unit.config?.auto_update_enabled === true;
      elements['source-config-requirement'].hidden = !unit.requirement;
      elements['source-config-requirement'].textContent = unit.requirement || '';
      sourceCredentialFields = unit.credentials || [];
      elements['source-credentials-fields'].replaceChildren();
      for (const field of sourceCredentialFields) {
        const group = document.createElement('div'); group.className = 'field-group';
        const label = document.createElement('label'); label.htmlFor = `credential-${field.name}`; label.textContent = field.label;
        const input = document.createElement('input'); input.className = 'form-input'; input.id = `credential-${field.name}`; input.type = 'password'; input.autocomplete = 'new-password'; input.maxLength = 512; input.placeholder = field.optional ? '留空可保持未配置' : '仅本次提交，之后不会显示'; input.required = !field.optional;
        group.append(label, input); elements['source-credentials-fields'].append(group);
      }
      elements['source-credentials'].hidden = sourceCredentialFields.length === 0;
      elements['source-config-error'].hidden = true;
      elements['source-dialog'].showModal();
      elements['source-config-name'].focus();
    } else if (button.dataset.action === 'rules-source') {
      resetRuleForm();
      elements['rule-source-id'].value = unit.id;
      document.getElementById('rules')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      elements['rule-name'].focus();
    } else if (button.dataset.action === 'download-source') {
      elements['download-source-id'].value = unit.id;
      elements['download-dialog-copy'].textContent = `系统将重新下载“${unit.config?.display_name || unit.displayName}”。校验成功前不会替换正在使用的数据；大型数据库可能消耗较多时间和流量。`;
      elements['download-preflight'].hidden = true;
      elements['download-confirm'].disabled = false;
      elements['download-confirm'].textContent = '确认下载到服务器';
      elements['download-dialog'].showModal();
      elements['download-confirm'].focus();
    } else if (button.dataset.action === 'update-source') {
      startDataUpdate(`/admin/api/data-sources/${encodeURIComponent(unit.id)}/update`, button, '正在启动…');
    }
  });

  elements['source-config-form'].addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = elements['source-config-submit'];
    button.disabled = true;
    button.textContent = '正在保存…';
    elements['source-config-error'].hidden = true;
    try {
      await postManagement(`/admin/api/data-sources/${encodeURIComponent(elements['source-config-id'].value)}/config`, {
        display_name: elements['source-config-name'].value.trim(),
        interval_hours: Number(elements['source-config-interval'].value),
        enabled: elements['source-config-enabled'].checked,
        auto_update_enabled: elements['source-config-auto'].checked,
      });
      if (sourceCredentialFields.length) {
        const credentials = Object.fromEntries(sourceCredentialFields.map((field) => [field.name, document.getElementById(`credential-${field.name}`).value]));
        if (Object.values(credentials).some(Boolean)) await postManagement(`/admin/api/data-sources/${encodeURIComponent(elements['source-config-id'].value)}/credentials`, credentials);
      }
      closeSourceDialog();
      showToast('数据源配置已保存');
      renderManagement(await fetchManagement());
    } catch (error) {
      elements['source-config-error'].textContent = error.message || '配置保存失败，请检查填写内容';
      elements['source-config-error'].hidden = false;
      elements['source-config-error'].focus?.();
    } finally {
      button.disabled = false;
      button.textContent = '保存数据源配置';
    }
  });

  elements['download-form'].addEventListener('submit', async (event) => {
    event.preventDefault();
    const sourceId = elements['download-source-id'].value;
    closeDownloadDialog();
    const path = sourceId === '__all__'
      ? '/admin/api/data-sources/force-download-all'
      : `/admin/api/data-sources/${encodeURIComponent(sourceId)}/download`;
    await startDataUpdate(path, elements['download-confirm'], '正在启动…');
  });

  elements['copy-secret'].addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(elements['generated-secret'].value);
      showToast('接入密钥已复制');
    } catch {
      elements['generated-secret'].focus();
      elements['generated-secret'].select();
      showToast('无法自动复制，请手动复制选中内容');
    }
  });
  elements['refresh-button'].addEventListener('click', () => refresh());
  window.addEventListener('hashchange', syncNavigation);
  elements['retry-button'].addEventListener('click', () => refresh());
  elements['logout-button'].addEventListener('click', logout);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && authenticated) refresh();
  });

  request('/admin/api/session').then(async (response) => {
    applySession(response.data);
    const [snapshot, management] = await Promise.all([fetchSnapshot(), fetchManagement()]);
    render(snapshot);
    renderManagement(management);
    startPolling();
  }).catch(() => {
    showLogin();
    elements['login-username'].focus();
  });
})();
