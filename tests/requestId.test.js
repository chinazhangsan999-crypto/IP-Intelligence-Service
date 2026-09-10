import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRequestId } from '../src/utils/requestId.js';

test('resolveRequestId preserves safe IDs and replaces unsafe values', () => {
  assert.equal(resolveRequestId('nav-01:req_123'), 'nav-01:req_123');
  assert.match(resolveRequestId('contains whitespace'), /^req_[0-9a-f-]{36}$/);
  assert.match(resolveRequestId(undefined), /^req_[0-9a-f-]{36}$/);
});
