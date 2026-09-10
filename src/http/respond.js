const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

export function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

export function sendError(
  res,
  requestId,
  statusCode,
  code,
  message,
  details = null,
  headers = {},
) {
  sendJson(res, statusCode, {
    request_id: requestId,
    code,
    message,
    details,
  }, headers);
}
