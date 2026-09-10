import assert from 'node:assert/strict';
import test from 'node:test';
import { createLogger } from '../src/utils/logger.js';

test('logger emits JSON and filters lower priority messages', () => {
  const lines = [];
  const logger = createLogger({ level: 'warn', sink: (line) => lines.push(line) });

  logger.info('ignored');
  logger.error('failed', { request_id: 'req_test', error: new Error('boom') });

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, 'error');
  assert.equal(entry.message, 'failed');
  assert.equal(entry.request_id, 'req_test');
  assert.equal(entry.error.message, 'boom');
  assert.equal('stack' in entry.error, false);
});
