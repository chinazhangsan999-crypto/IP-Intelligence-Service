const LEVEL_PRIORITY = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

function serializeError(error) {
  if (!(error instanceof Error)) return error;

  return {
    name: error.name,
    message: error.message,
    code: error.code,
  };
}

function normalizeFields(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, serializeError(value)]),
  );
}

export function createLogger({ level = 'info', sink = console.log } = {}) {
  const minimumPriority = LEVEL_PRIORITY[level] ?? LEVEL_PRIORITY.info;

  function write(logLevel, message, fields) {
    if (LEVEL_PRIORITY[logLevel] < minimumPriority) return;
    sink(JSON.stringify({
      ...normalizeFields(fields),
      timestamp: new Date().toISOString(),
      level: logLevel,
      message,
    }));
  }

  return Object.freeze({
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  });
}
