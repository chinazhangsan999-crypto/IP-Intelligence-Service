import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';

export function hashRequestBody(rawBody = Buffer.alloc(0)) {
  return createHash('sha256').update(rawBody).digest('hex');
}

export function buildCanonicalRequest({ method, requestTarget, timestamp, nonce, rawBody }) {
  return [
    String(method).toUpperCase(),
    requestTarget,
    String(timestamp),
    nonce,
    hashRequestBody(rawBody),
  ].join('\n');
}

export function createRequestSignature(secret, request) {
  return createHmac('sha256', secret)
    .update(buildCanonicalRequest(request), 'utf8')
    .digest('hex');
}

export function signaturesMatch(actualHex, expectedHex) {
  if (!/^[0-9a-f]{64}$/.test(actualHex) || !/^[0-9a-f]{64}$/.test(expectedHex)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(actualHex, 'hex'), Buffer.from(expectedHex, 'hex'));
}
