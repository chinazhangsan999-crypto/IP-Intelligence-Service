import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './http/HttpError.js';
import { sendError, sendJson } from './http/respond.js';
import { resolveRequestId } from './utils/requestId.js';
import { normalizeClassificationRule } from './services/ClassificationRuleService.js';
import { DATA_SOURCE_UNIT_IDS, DATA_SOURCE_UNITS } from './data/dataSourceCatalog.js';

function getPathname(req) {
  try {
    return new URL(req.url, 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

async function readRawBody(req, maxBytes) {
  const contentLength = Number(req.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    req.resume();
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      req.resume();
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function routeKind(method, pathname) {
  if (method === 'GET' && pathname === '/') return 'public-index';
  if (method === 'GET' && pathname === '/app.css') return 'public-style';
  if (method === 'GET' && pathname === '/app.js') return 'public-script';
  if (method === 'GET' && pathname === '/api/public/lookup') return 'public-lookup';
  if (method === 'GET' && (pathname === '/admin' || pathname === '/admin/')) return 'admin-index';
  if (method === 'GET' && pathname === '/admin/app.css') return 'admin-style';
  if (method === 'GET' && pathname === '/admin/app.js') return 'admin-script';
  if (method === 'POST' && pathname === '/admin/api/login') return 'admin-login';
  if (method === 'GET' && pathname === '/admin/api/session') return 'admin-session';
  if (method === 'POST' && pathname === '/admin/api/logout') return 'admin-logout';
  if (method === 'POST' && pathname === '/admin/api/account') return 'admin-account';
  if (method === 'GET' && pathname === '/admin/api/observability') return 'admin-observability';
  if (method === 'GET' && pathname === '/admin/api/management') return 'admin-management';
  if (method === 'GET' && pathname === '/admin/api/data-sources') return 'admin-data-sources';
  if (method === 'GET' && pathname === '/admin/api/source-credentials') return 'admin-source-credentials';
  if (method === 'GET' && pathname === '/admin/api/data-sources/force-download-preflight') return 'admin-data-force-preflight';
  if (method === 'POST' && pathname === '/admin/api/clients') return 'admin-client-create';
  if (method === 'POST' && /^\/admin\/api\/clients\/[^/]+\/rotate$/.test(pathname)) return 'admin-client-rotate';
  if (method === 'POST' && /^\/admin\/api\/clients\/[^/]+\/status$/.test(pathname)) return 'admin-client-status';
  if (method === 'POST' && pathname === '/admin/api/classification-rules') return 'admin-rule-save';
  if (method === 'POST' && /^\/admin\/api\/classification-rules\/\d+$/.test(pathname)) return 'admin-rule-update';
  if (method === 'POST' && /^\/admin\/api\/classification-rules\/\d+\/status$/.test(pathname)) return 'admin-rule-status';
  if (method === 'POST' && pathname === '/admin/api/data-update') return 'admin-data-update';
  if (method === 'POST' && pathname === '/admin/api/data-sources/check-all') return 'admin-data-check-all';
  if (method === 'POST' && pathname === '/admin/api/data-sources/update-all') return 'admin-data-update-all';
  if (method === 'POST' && pathname === '/admin/api/data-sources/force-download-all') return 'admin-data-force-all';
  if (method === 'POST' && /^\/admin\/api\/data-sources\/[^/]+\/config$/.test(pathname)) return 'admin-data-source-config';
  if (method === 'POST' && /^\/admin\/api\/data-sources\/[^/]+\/credentials$/.test(pathname)) return 'admin-source-credentials-save';
  if (method === 'POST' && /^\/admin\/api\/data-sources\/[^/]+\/(download|update)$/.test(pathname)) return 'admin-data-source-action';
  if (method === 'GET' && pathname === '/health') return 'health';
  if (method === 'GET' && pathname === '/metrics') return 'metrics';
  if (method === 'GET' && pathname === '/ready') return 'ready';
  if (method === 'GET' && pathname === '/v1/meta/sources') return 'sources';
  if (method === 'GET' && pathname === '/v1/meta/observability') return 'observability';
  if (method === 'POST' && pathname === '/v1/ip/lookup') return 'lookup';
  return null;
}

function allowedMethods(pathname) {
  if (/^\/admin\/api\/clients\/[^/]+\/(rotate|status)$/.test(pathname)) return ['POST'];
  if (/^\/admin\/api\/classification-rules\/\d+\/status$/.test(pathname)) return ['POST'];
  if (/^\/admin\/api\/classification-rules\/\d+$/.test(pathname)) return ['POST'];
  if (/^\/admin\/api\/data-sources\/[^/]+\/(config|download|update)$/.test(pathname)) return ['POST'];
  if (/^\/admin\/api\/data-sources\/[^/]+\/credentials$/.test(pathname)) return ['POST'];
  return {
    '/': ['GET'],
    '/app.css': ['GET'],
    '/app.js': ['GET'],
    '/api/public/lookup': ['GET'],
    '/admin': ['GET'],
    '/admin/': ['GET'],
    '/admin/app.css': ['GET'],
    '/admin/app.js': ['GET'],
    '/admin/api/login': ['POST'],
    '/admin/api/session': ['GET'],
    '/admin/api/logout': ['POST'],
    '/admin/api/account': ['POST'],
    '/admin/api/observability': ['GET'],
    '/admin/api/management': ['GET'],
    '/admin/api/data-sources': ['GET'],
    '/admin/api/source-credentials': ['GET'],
    '/admin/api/data-sources/force-download-preflight': ['GET'],
    '/admin/api/clients': ['POST'],
    '/admin/api/classification-rules': ['POST'],
    '/admin/api/data-update': ['POST'],
    '/admin/api/data-sources/check-all': ['POST'],
    '/admin/api/data-sources/update-all': ['POST'],
    '/admin/api/data-sources/force-download-all': ['POST'],
    '/health': ['GET'],
    '/metrics': ['GET'],
    '/ready': ['GET'],
    '/v1/meta/sources': ['GET'],
    '/v1/meta/observability': ['GET'],
    '/v1/ip/lookup': ['POST'],
  }[pathname] || null;
}

function routeLabel(pathname) {
  if (/^\/admin\/api\/clients\/[^/]+\/(rotate|status)$/.test(pathname)) return '/admin/api/clients/:id/action';
  if (/^\/admin\/api\/classification-rules\/\d+\/status$/.test(pathname)) return '/admin/api/classification-rules/:id/status';
  if (/^\/admin\/api\/classification-rules\/\d+$/.test(pathname)) return '/admin/api/classification-rules/:id';
  if (/^\/admin\/api\/data-sources\/[^/]+\/(config|download|update)$/.test(pathname)) return '/admin/api/data-sources/:id/action';
  if (/^\/admin\/api\/data-sources\/[^/]+\/credentials$/.test(pathname)) return '/admin/api/data-sources/:id/credentials';
  if (allowedMethods(pathname)) return pathname;
  return 'unmatched';
}

function hasValidBearerToken(header, expectedToken) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(expectedToken, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sendPrometheus(res, body) {
  res.writeHead(200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function sendAdminAsset(res, asset, isDocument = false) {
  const headers = {
    'content-type': asset.contentType,
    'content-length': asset.body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  };
  if (isDocument) {
    headers['content-security-policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
  }
  res.writeHead(200, headers);
  res.end(asset.body);
}

function sendPublicAsset(res, asset, isDocument = false) {
  const headers = {
    'content-type': asset.contentType,
    'content-length': asset.body.length,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (isDocument) {
    headers['content-security-policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
  }
  res.writeHead(200, headers);
  res.end(asset.body);
}

function getPublicClientAddress(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = typeof value === 'string' ? value.split(',', 1)[0].trim() : '';
    if (first && first.length <= 64) return first;
  }
  return req.socket.remoteAddress || '';
}

function publicLookupSourcesReady(snapshot) {
  const states = new Map(snapshot.sources.map((source) => [source.id, source]));
  return states.get('dbip-city')?.ready === true && states.get('dbip-asn')?.ready === true;
}

function isJsonContentType(value) {
  return typeof value === 'string'
    && value.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function parseLookupRequest(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request body must be an object');
  }
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'ips' || !Array.isArray(payload.ips) || payload.ips.length < 1) {
    throw new HttpError(400, 'INVALID_REQUEST', 'ips must contain between 1 and 100 items');
  }
  if (payload.ips.length > 100) {
    throw new HttpError(422, 'BATCH_LIMIT_EXCEEDED', 'ips cannot contain more than 100 items');
  }
  if (payload.ips.some((ip) => typeof ip !== 'string' || ip.length > 64)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Each ips item must be a string no longer than 64 characters');
  }
  return payload.ips;
}

function parseJsonObject(rawBody) {
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'Request body must be an object');
  }
  return payload;
}

function parseCookies(header) {
  if (typeof header !== 'string') return {};
  return Object.fromEntries(header.split(';').map((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return null;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return [name, value];
  }).filter(Boolean));
}

function adminSessionCookie(value, maxAgeSeconds = 43_200) {
  return `ip_admin_session=${value}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

function requireSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    if (new URL(origin).host !== req.headers.host) {
      throw new HttpError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed');
  }
}

export function createHttpServer({
  config,
  logger,
  readiness,
  authenticator = null,
  lookupService = null,
  usageRepository = null,
  metrics = null,
  updateScheduler = null,
  databasePool = null,
  adminAssets = null,
  publicAssets = null,
  publicRateLimiter = null,
  adminAuthService = null,
  adminRateLimiter = null,
  apiClientService = null,
  managementRepository = null,
  reloadClassificationRules = null,
}) {
  const server = http.createServer((req, res) => {
    const startedAt = process.hrtime.bigint();
    const requestId = resolveRequestId(req.headers['x-request-id']);
    const pathname = getPathname(req);
    const metricRoute = routeLabel(pathname);

    res.setHeader('x-request-id', requestId);
    res.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const slow = durationMs >= (config.observability?.slowRequestMs ?? 1_000);
      metrics?.observeHttp({
        method: req.method,
        route: metricRoute,
        statusCode: res.statusCode,
        durationMs,
        slow,
      });
      logger.info('request_completed', {
        request_id: requestId,
        method: req.method,
        route: metricRoute,
        status_code: res.statusCode,
        duration_ms: Number(durationMs.toFixed(2)),
      });
      if (slow) {
        logger.warn('slow_request', {
          request_id: requestId,
          method: req.method,
          route: metricRoute,
          status_code: res.statusCode,
          duration_ms: Number(durationMs.toFixed(2)),
          threshold_ms: config.observability?.slowRequestMs ?? 1_000,
        });
      }
    });

    async function handle() {
      const kind = routeKind(req.method, pathname);
      if (!kind) {
        const methods = allowedMethods(pathname);
        if (methods) {
          sendError(res, requestId, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed', null, {
            allow: methods.join(', '),
          });
          return;
        }
        sendError(res, requestId, 404, 'NOT_FOUND', 'Route not found');
        return;
      }

      if (['admin-index', 'admin-style', 'admin-script'].includes(kind)) {
        const assetName = {
          'admin-index': 'index',
          'admin-style': 'style',
          'admin-script': 'script',
        }[kind];
        const asset = adminAssets?.[assetName];
        if (!asset) throw new HttpError(503, 'SERVICE_NOT_READY', 'Admin interface is not available');
        sendAdminAsset(res, asset, kind === 'admin-index');
        return;
      }

      if (kind.startsWith('public-') && kind !== 'public-lookup') {
        const assetName = {
          'public-index': 'index',
          'public-style': 'style',
          'public-script': 'script',
        }[kind];
        const asset = publicAssets?.[assetName];
        if (!asset) throw new HttpError(503, 'SERVICE_NOT_READY', 'Public interface is not available');
        sendPublicAsset(res, asset, kind === 'public-index');
        return;
      }

      if (kind === 'health') {
        sendJson(res, 200, {
          request_id: requestId,
          ok: true,
          service: config.serviceName,
        });
        return;
      }

      if (kind === 'metrics') {
        if (!config.observability?.metricsEnabled) {
          sendError(res, requestId, 404, 'NOT_FOUND', 'Route not found');
          return;
        }
        if (!hasValidBearerToken(req.headers.authorization, config.observability.metricsToken)) {
          sendError(res, requestId, 401, 'UNAUTHORIZED', 'Valid metrics bearer token required', null, {
            'www-authenticate': 'Bearer',
          });
          return;
        }
        if (!metrics) throw new HttpError(503, 'SERVICE_NOT_READY', 'Metrics service is not configured');
        sendPrometheus(res, metrics.renderPrometheus({
          serviceName: config.serviceName,
          readiness,
          updateScheduler,
          pool: databasePool,
        }));
        return;
      }

      if (kind.startsWith('admin-')) {
        if (!adminAuthService) throw new HttpError(503, 'SERVICE_NOT_READY', 'Admin authentication is not configured');

        if (kind === 'admin-login') {
          requireSameOrigin(req);
          if (!isJsonContentType(req.headers['content-type'])) {
            req.resume();
            throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
          }
          const clientAddress = getPublicClientAddress(req, config.publicLookup?.trustProxy === true);
          const rate = adminRateLimiter?.consume(`login:${clientAddress || 'unknown'}`, 10);
          if (rate && !rate.allowed) {
            throw new HttpError(429, 'RATE_LIMITED', '登录尝试过于频繁，请稍后再试', {
              headers: { 'retry-after': String(rate.retryAfterSeconds) },
            });
          }
          const payload = parseJsonObject(await readRawBody(req, config.security.maxBodyBytes));
          const result = await adminAuthService.login(payload.username, payload.password);
          sendJson(res, 200, {
            request_id: requestId,
            code: 'OK',
            data: { user: result.user, csrf_token: result.csrfToken, expires_at: result.expiresAt },
          }, { 'set-cookie': adminSessionCookie(result.sessionToken) });
          return;
        }

        const sessionToken = parseCookies(req.headers.cookie).ip_admin_session;
        const session = await adminAuthService.authenticate(sessionToken);
        if (!session) {
          sendError(res, requestId, 401, 'UNAUTHORIZED', '请先登录管理后台');
          return;
        }

        if (kind === 'admin-session') {
          const csrfToken = await adminAuthService.refreshCsrf(session);
          sendJson(res, 200, {
            request_id: requestId,
            code: 'OK',
            data: {
              user: { id: session.admin_user_id, username: session.username },
              csrf_token: csrfToken,
              expires_at: session.expires_at,
            },
          });
          return;
        }

        const adminMutation = req.method === 'POST' && !['admin-login'].includes(kind);
        if (adminMutation) {
          requireSameOrigin(req);
          if (!adminAuthService.verifyCsrf(session, req.headers['x-csrf-token'])) {
            throw new HttpError(403, 'CSRF_REJECTED', '安全校验失败，请重新登录');
          }
        }

        if (kind === 'admin-logout') {
          await adminAuthService.logout(session);
          sendJson(res, 200, { request_id: requestId, code: 'OK' }, {
            'set-cookie': adminSessionCookie('', 0),
          });
          return;
        }

        if (kind === 'admin-account') {
          if (!isJsonContentType(req.headers['content-type'])) {
            req.resume();
            throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
          }
          const payload = parseJsonObject(await readRawBody(req, config.security.maxBodyBytes));
          await adminAuthService.changeCredentials(session, {
            currentPassword: payload.current_password,
            username: payload.username,
            newPassword: payload.new_password,
          });
          sendJson(res, 200, {
            request_id: requestId,
            code: 'OK',
            data: { relogin_required: true },
          }, { 'set-cookie': adminSessionCookie('', 0) });
          return;
        }

      if (kind === 'admin-observability') {
        if (!metrics) throw new HttpError(503, 'SERVICE_NOT_READY', 'Metrics service is not configured');
        sendJson(res, 200, {
          request_id: requestId,
          code: 'OK',
          data: metrics.snapshot({ readiness, updateScheduler, pool: databasePool }),
        });
        return;
      }

      if (kind === 'admin-management') {
        if (!apiClientService || !managementRepository) throw new HttpError(503, 'SERVICE_NOT_READY', '管理数据尚未就绪');
        const [clients, rules, activity] = await Promise.all([
          apiClientService.listClients(),
          managementRepository.listClassificationRules(),
          managementRepository.getAdminManagementSnapshot(),
        ]);
        const dataSources = await updateScheduler?.managementSnapshot?.() || [];
        sendJson(res, 200, {
          request_id: requestId,
          code: 'OK',
          data: { clients, classification_rules: rules, data_sources: dataSources, update_state: updateScheduler?.snapshot?.() || null, ...activity },
        });
        return;
      }

      if (kind === 'admin-data-sources') {
        if (!updateScheduler || !managementRepository) throw new HttpError(503, 'SERVICE_NOT_READY', '数据源管理尚未就绪');
        sendJson(res, 200, {
          request_id: requestId,
          code: 'OK',
          data: { data_sources: await updateScheduler.managementSnapshot(), update_state: updateScheduler.snapshot() },
        });
        return;
      }

      if (kind === 'admin-source-credentials') {
        if (!managementRepository) throw new HttpError(503, 'SERVICE_NOT_READY', '凭据库尚未就绪');
        sendJson(res, 200, { request_id: requestId, code: 'OK', data: { credentials: await managementRepository.listSourceCredentialStatus() } });
        return;
      }

      if (kind === 'admin-data-force-preflight') {
        if (!updateScheduler) throw new HttpError(503, 'SERVICE_NOT_READY', '数据更新器尚未就绪');
        sendJson(res, 200, {
          request_id: requestId,
          code: 'OK',
          data: await updateScheduler.forceDownloadPreflight(),
        });
        return;
      }

      if (['admin-client-create', 'admin-client-rotate', 'admin-client-status', 'admin-rule-save', 'admin-rule-update', 'admin-rule-status', 'admin-data-source-config', 'admin-source-credentials-save'].includes(kind)) {
        if (!isJsonContentType(req.headers['content-type'])) {
          req.resume();
          throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
        }
        const clientAction = ['admin-client-create', 'admin-client-rotate', 'admin-client-status'].includes(kind);
        if (!managementRepository || (clientAction && !apiClientService)) throw new HttpError(503, 'SERVICE_NOT_READY', '管理数据尚未就绪');
        const payload = parseJsonObject(await readRawBody(req, config.security.maxBodyBytes));
        try {
          if (kind === 'admin-client-create') {
            const result = await apiClientService.createClient({
              clientId: payload.client_id,
              displayName: payload.display_name,
              rateLimitPerMinute: Number(payload.rate_limit_per_minute),
            });
            await managementRepository.recordAudit({ eventType: 'admin_client_create', outcome: 'success', requestId, metadata: { client_id: result.client.client_id } });
            sendJson(res, 201, { request_id: requestId, code: 'OK', data: result });
            return;
          }
          const clientMatch = pathname.match(/^\/admin\/api\/clients\/([^/]+)\/(rotate|status)$/);
          if (clientMatch) {
            const clientId = decodeURIComponent(clientMatch[1]);
            const result = kind === 'admin-client-rotate'
              ? await apiClientService.rotateClientSecret(clientId)
              : { client: await apiClientService.setClientStatus(clientId, payload.status) };
            if (!result?.client) throw new HttpError(404, 'NOT_FOUND', '接入方不存在');
            await managementRepository.recordAudit({ eventType: kind, outcome: 'success', requestId, metadata: { client_id: clientId } });
            sendJson(res, 200, { request_id: requestId, code: 'OK', data: result });
            return;
          }
          if (kind === 'admin-rule-save') {
            const ruleSourceId = String(payload.source_id || '').trim() || null;
            if (ruleSourceId && !DATA_SOURCE_UNIT_IDS.has(ruleSourceId)) throw new HttpError(422, 'INVALID_MANAGEMENT_INPUT', '关联数据源不存在');
            const normalizedRule = normalizeClassificationRule({
              name: payload.name,
              priority: Number(payload.priority),
              matchType: payload.match_type,
              matchValue: payload.match_value,
              networkType: payload.network_type,
              confidence: payload.confidence,
              flags: payload.flags,
              enabled: payload.enabled,
            });
            const rule = await managementRepository.saveClassificationRule({ ...normalizedRule, sourceId: ruleSourceId, enabled: payload.enabled });
            await reloadClassificationRules?.();
            await managementRepository.recordAudit({ eventType: 'admin_rule_save', outcome: 'success', requestId, metadata: { rule_id: rule.id, name: rule.name } });
            sendJson(res, 200, { request_id: requestId, code: 'OK', data: { rule } });
            return;
          }
          if (kind === 'admin-rule-update') {
            const ruleId = Number(pathname.match(/classification-rules\/(\d+)$/)?.[1]);
            const ruleSourceId = String(payload.source_id || '').trim() || null;
            if (ruleSourceId && !DATA_SOURCE_UNIT_IDS.has(ruleSourceId)) throw new HttpError(422, 'INVALID_MANAGEMENT_INPUT', '关联数据源不存在');
            const normalizedRule = normalizeClassificationRule({
              name: payload.name,
              priority: Number(payload.priority),
              matchType: payload.match_type,
              matchValue: payload.match_value,
              networkType: payload.network_type,
              confidence: payload.confidence,
              flags: payload.flags,
              enabled: payload.enabled,
            });
            const rule = await managementRepository.updateClassificationRule(ruleId, { ...normalizedRule, sourceId: ruleSourceId, enabled: payload.enabled });
            if (!rule) throw new HttpError(404, 'NOT_FOUND', '判断规则不存在');
            await reloadClassificationRules?.();
            await managementRepository.recordAudit({ eventType: 'admin_rule_update', outcome: 'success', requestId, metadata: { rule_id: rule.id, name: rule.name } });
            sendJson(res, 200, { request_id: requestId, code: 'OK', data: { rule } });
            return;
          }
          if (kind === 'admin-data-source-config') {
            const sourceId = decodeURIComponent(pathname.match(/data-sources\/([^/]+)\/config$/)?.[1] || '');
            if (!DATA_SOURCE_UNIT_IDS.has(sourceId)) throw new HttpError(404, 'NOT_FOUND', '数据源不存在');
            const displayName = String(payload.display_name || '').trim();
            const intervalHours = Number(payload.interval_hours);
            if (!displayName || displayName.length > 128 || !Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 744) {
              throw new HttpError(422, 'INVALID_MANAGEMENT_INPUT', '请填写有效的数据源名称和 1～744 小时更新周期');
            }
            const config = await managementRepository.updateDataSourceConfig(sourceId, {
              displayName,
              enabled: payload.enabled === true,
              autoUpdateEnabled: payload.auto_update_enabled === true,
              intervalHours,
            }, session.admin_user_id);
            await managementRepository.recordAudit({ eventType: 'admin_data_source_config', outcome: 'success', requestId, metadata: { source_id: sourceId } });
            sendJson(res, 200, { request_id: requestId, code: 'OK', data: { config } });
            return;
          }
          if (kind === 'admin-source-credentials-save') {
            const sourceId = decodeURIComponent(pathname.match(/data-sources\/([^/]+)\/credentials$/)?.[1] || '');
            const unit = DATA_SOURCE_UNITS.find((item) => item.id === sourceId);
            if (!unit?.credentials?.length) throw new HttpError(404, 'NOT_FOUND', '该数据源不需要服务器凭据');
            for (const field of unit.credentials) {
              const value = String(payload[field.name] || '').trim();
              if (!value) { if (field.optional) continue; throw new HttpError(422, 'INVALID_MANAGEMENT_INPUT', `${field.label} 不能为空`); }
              if (value.length > 512) throw new HttpError(422, 'INVALID_MANAGEMENT_INPUT', '凭据长度无效');
              await managementRepository.setSourceCredential(sourceId, field.name, value, config.clientSecretMasterKey, session.admin_user_id);
            }
            await managementRepository.recordAudit({ eventType: 'admin_source_credentials_save', outcome: 'success', requestId, metadata: { source_id: sourceId, fields: unit.credentials.map((field) => field.name) } });
            sendJson(res, 200, { request_id: requestId, code: 'OK', data: { saved: true } });
            return;
          }
          const ruleId = Number(pathname.match(/classification-rules\/(\d+)\/status$/)?.[1]);
          const rule = await managementRepository.setClassificationRuleEnabled(ruleId, payload.enabled === true);
          if (!rule) throw new HttpError(404, 'NOT_FOUND', '判断规则不存在');
          await reloadClassificationRules?.();
          await managementRepository.recordAudit({ eventType: 'admin_rule_status', outcome: 'success', requestId, metadata: { rule_id: rule.id, enabled: rule.enabled } });
          sendJson(res, 200, { request_id: requestId, code: 'OK', data: { rule } });
          return;
        } catch (error) {
          if (error instanceof HttpError) throw error;
          if (error?.code === '23505') throw new HttpError(409, 'ALREADY_EXISTS', '名称或接入方 ID 已存在');
          throw new HttpError(422, 'INVALID_MANAGEMENT_INPUT', String(error.message || '管理参数无效'));
        }
      }

      if (kind === 'admin-data-update') {
        if (!updateScheduler) throw new HttpError(503, 'SERVICE_NOT_READY', '数据更新器尚未就绪');
        if (updateScheduler.snapshot().running) throw new HttpError(409, 'UPDATE_RUNNING', '数据更新任务正在执行');
        if (isJsonContentType(req.headers['content-type'])) parseJsonObject(await readRawBody(req, config.security.maxBodyBytes));
        void updateScheduler.runCycle({ trigger: 'manual' });
        await managementRepository?.recordAudit({ eventType: 'admin_data_update', outcome: 'success', requestId, metadata: { trigger: 'manual' } });
        sendJson(res, 202, { request_id: requestId, code: 'ACCEPTED', data: { started: true } });
        return;
      }

      if (['admin-data-check-all', 'admin-data-update-all', 'admin-data-force-all', 'admin-data-source-action'].includes(kind)) {
        if (!updateScheduler || !managementRepository) throw new HttpError(503, 'SERVICE_NOT_READY', '数据更新器尚未就绪');
        if (updateScheduler.snapshot().running) throw new HttpError(409, 'UPDATE_RUNNING', '已有数据更新任务正在执行');
        if (isJsonContentType(req.headers['content-type'])) parseJsonObject(await readRawBody(req, config.security.maxBodyBytes));
        let unitIds = null;
        let force = false;
        let eventType = 'admin_data_update_all';
        if (kind === 'admin-data-check-all') {
          eventType = 'admin_data_check_all';
        } else if (kind === 'admin-data-force-all') {
          force = true;
          eventType = 'admin_data_force_download_all';
        } else if (kind === 'admin-data-source-action') {
          const match = pathname.match(/data-sources\/([^/]+)\/(download|update)$/);
          const sourceId = decodeURIComponent(match?.[1] || '');
          if (!DATA_SOURCE_UNIT_IDS.has(sourceId)) throw new HttpError(404, 'NOT_FOUND', '数据源不存在');
          unitIds = [sourceId];
          force = match?.[2] === 'download';
          eventType = force ? 'admin_data_source_download' : 'admin_data_source_update';
        }
        if (kind === 'admin-data-check-all') {
          const sources = await updateScheduler.managementSnapshot();
          await managementRepository.recordAudit({ eventType, outcome: 'success', requestId, metadata: { source_count: sources.length } });
          sendJson(res, 200, { request_id: requestId, code: 'OK', data: { data_sources: sources, update_state: updateScheduler.snapshot() } });
          return;
        }
        void updateScheduler.runCycle({
          unitIds,
          force,
          trigger: 'manual',
          validateAfterUpdate: kind === 'admin-data-force-all',
        });
        await managementRepository.recordAudit({ eventType, outcome: 'success', requestId, metadata: { source_id: unitIds?.[0] || null, force } });
        sendJson(res, 202, { request_id: requestId, code: 'ACCEPTED', data: { started: true, source_id: unitIds?.[0] || 'all-data-sources', force } });
        return;
      }
      }


      if (kind === 'public-lookup') {
        if (config.publicLookup?.enabled === false) {
          sendError(res, requestId, 404, 'NOT_FOUND', 'Route not found');
          return;
        }
        if (!lookupService) {
          throw new HttpError(503, 'SERVICE_NOT_READY', 'IP lookup service is not configured');
        }
        const clientAddress = getPublicClientAddress(req, config.publicLookup?.trustProxy === true);
        const rate = publicRateLimiter?.consume(clientAddress || 'unknown', config.publicLookup?.rateLimitPerMinute ?? 30);
        if (rate) {
          res.setHeader('x-rate-limit-limit', String(rate.limit));
          res.setHeader('x-rate-limit-remaining', String(rate.remaining));
          res.setHeader('x-rate-limit-reset', String(rate.resetAfterSeconds));
          if (!rate.allowed) {
            throw new HttpError(429, 'RATE_LIMITED', 'Too many public lookup requests', {
              headers: { 'retry-after': String(rate.retryAfterSeconds) },
            });
          }
        }
        const snapshot = readiness.snapshot();
        if (!publicLookupSourcesReady(snapshot)) {
          throw new HttpError(503, 'SERVICE_NOT_READY', 'Required IP data sources are not ready');
        }
        const url = new URL(req.url, 'http://localhost');
        const requestedIp = url.searchParams.get('ip');
        const input = requestedIp === null || requestedIp.trim() === '' ? clientAddress : requestedIp;
        if (typeof input !== 'string' || input.length > 64) {
          throw new HttpError(400, 'INVALID_REQUEST', 'ip must be a valid IPv4 or IPv6 address');
        }
        const result = lookupService.lookupBatch([input]);
        metrics?.observeLookup(result.meta);
        const item = result.data[0];
        if (item?.status === 'invalid') {
          throw new HttpError(400, 'INVALID_IP', 'Please enter a valid IPv4 or IPv6 address');
        }
        sendJson(res, 200, {
          request_id: requestId,
          code: 'OK',
          data: item,
          meta: result.meta,
        });
        return;
      }

      if (req.method === 'POST' && !isJsonContentType(req.headers['content-type'])) {
        req.resume();
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
      }
      const rawBody = req.method === 'POST' ? await readRawBody(req, config.security.maxBodyBytes) : Buffer.alloc(0);

      if (!authenticator) {
        throw new HttpError(503, 'SERVICE_NOT_READY', 'Authentication service is not configured');
      }

      const authentication = await authenticator.authenticate({
        headers: req.headers,
        method: req.method,
        requestTarget: req.url,
        rawBody,
        requestId,
      });
      if (authentication.rate_limit_limit !== undefined) {
        res.setHeader('x-rate-limit-limit', String(authentication.rate_limit_limit));
      }
      res.setHeader('x-rate-limit-remaining', String(authentication.rate_limit_remaining));
      if (authentication.rate_limit_reset !== undefined) {
        res.setHeader('x-rate-limit-reset', String(authentication.rate_limit_reset));
      }

      const snapshot = readiness.snapshot();
      if (kind === 'ready') {
        if (!snapshot.required_sources_ready) {
          throw new HttpError(
            503,
            'SERVICE_NOT_READY',
            'Required IP data sources are not ready',
            { details: snapshot },
          );
        }
        sendJson(res, 200, { request_id: requestId, ok: true, ...snapshot });
        return;
      }

      if (kind === 'sources') {
        sendJson(res, 200, {
          request_id: requestId,
          code: 'OK',
          data: snapshot.sources.map((source) => ({
            id: source.id,
            status: source.status,
            required: source.required,
            version: source.version,
            updated_at: source.updated_at,
            expires_at: source.expires_at,
            last_error: source.message,
          })),
        });
        return;
      }


      if (kind === 'observability') {
        if (!metrics) throw new HttpError(503, 'SERVICE_NOT_READY', 'Metrics service is not configured');
        sendJson(res, 200, {
          request_id: requestId,
          code: 'OK',
          data: metrics.snapshot({ readiness, updateScheduler, pool: databasePool }),
        });
        return;
      }

      const ips = parseLookupRequest(rawBody);
      if (!lookupService) {
        throw new HttpError(503, 'SERVICE_NOT_READY', 'IP lookup service is not configured');
      }
      if (!snapshot.required_sources_ready) {
        throw new HttpError(
          503,
          'SERVICE_NOT_READY',
          'Required IP data sources are not ready',
          { details: snapshot },
        );
      }

      const result = lookupService.lookupBatch(ips);
      metrics?.observeLookup(result.meta);
      if (usageRepository) {
        const bucketStart = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
        Promise.resolve().then(() => usageRepository.recordUsage({
          apiClientId: authentication.client.id,
          bucketStart,
          requests: 1,
          ips: result.meta.unique_count,
          successes: result.meta.resolved_count,
          errors: result.meta.invalid_count + result.meta.unavailable_count,
        })).catch((error) => logger.error('usage_record_failed', {
          request_id: requestId,
          api_client_id: authentication.client.id,
          error,
        }));
      }
      sendJson(res, 200, {
        request_id: requestId,
        code: 'OK',
        data: result.data,
        meta: result.meta,
      });
    }

    handle().catch((error) => {
      if (error instanceof HttpError) {
        sendError(
          res,
          requestId,
          error.statusCode,
          error.code,
          error.message,
          error.details,
          error.headers,
        );
        return;
      }

      logger.error('request_failed', {
        request_id: requestId,
        method: req.method,
        route: metricRoute,
        error,
      });

      if (!res.headersSent) {
        sendError(res, requestId, 500, 'INTERNAL_ERROR', 'Internal server error');
      } else {
        res.destroy();
      }
    });
  });

  server.requestTimeout = config.http?.requestTimeoutMs ?? 10_000;
  server.headersTimeout = config.http?.headersTimeoutMs ?? 10_000;
  server.keepAliveTimeout = config.http?.keepAliveTimeoutMs ?? 5_000;
  return server;
}
