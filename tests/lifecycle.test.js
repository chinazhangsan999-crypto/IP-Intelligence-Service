import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { installGracefulShutdown } from '../src/lifecycle.js';

test('graceful shutdown closes the server once, cleans up, and unregisters listeners', async () => {
  const signals = new EventEmitter();
  const events = [];
  let closeCalls = 0;
  let idleCloseCalls = 0;
  let exitCode = 0;
  let cleanupCalls = 0;
  const server = {
    close(callback) {
      closeCalls += 1;
      callback();
    },
    closeIdleConnections() {
      idleCloseCalls += 1;
    },
  };
  const logger = {
    info(message) { events.push(message); },
    error(message) { events.push(message); },
  };

  const uninstall = installGracefulShutdown({
    server,
    logger,
    timeoutMs: 1_000,
    signalSource: signals,
    setExitCode(value) { exitCode = value; },
    forceExit() { throw new Error('forceExit must not run'); },
    async cleanup() { cleanupCalls += 1; },
  });

  signals.emit('SIGTERM', 'SIGTERM');
  signals.emit('SIGINT', 'SIGINT');
  await new Promise((resolve) => setImmediate(resolve));
  uninstall();

  assert.equal(closeCalls, 1);
  assert.equal(idleCloseCalls, 1);
  assert.equal(cleanupCalls, 1);
  assert.equal(exitCode, 0);
  assert.deepEqual(events, ['shutdown_started', 'shutdown_completed']);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});
