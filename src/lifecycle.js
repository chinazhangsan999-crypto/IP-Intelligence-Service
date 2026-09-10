export function installGracefulShutdown({
  server,
  logger,
  timeoutMs,
  cleanup = async () => {},
  signalSource = process,
  setExitCode = (value) => { process.exitCode = value; },
  forceExit = (value) => process.exit(value),
}) {
  let shuttingDown = false;

  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown_started', { signal, timeout_ms: timeoutMs });

    const forceTimer = setTimeout(() => {
      logger.error('shutdown_forced', { signal });
      server.closeAllConnections?.();
      forceExit(1);
    }, timeoutMs);
    forceTimer.unref();

    server.close(async (error) => {
      if (error) {
        clearTimeout(forceTimer);
        logger.error('shutdown_failed', { signal, error });
        setExitCode(1);
        return;
      }
      try {
        await cleanup();
        clearTimeout(forceTimer);
        logger.info('shutdown_completed', { signal });
      } catch (cleanupError) {
        clearTimeout(forceTimer);
        logger.error('shutdown_cleanup_failed', { signal, error: cleanupError });
        setExitCode(1);
      }
    });
    server.closeIdleConnections?.();
  }

  signalSource.once('SIGINT', shutdown);
  signalSource.once('SIGTERM', shutdown);

  return () => {
    signalSource.removeListener('SIGINT', shutdown);
    signalSource.removeListener('SIGTERM', shutdown);
  };
}
