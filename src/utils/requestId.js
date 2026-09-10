import { randomUUID } from 'node:crypto';

const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export function resolveRequestId(value) {
  if (typeof value === 'string' && SAFE_REQUEST_ID.test(value)) return value;
  return `req_${randomUUID()}`;
}
