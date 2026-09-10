import { loadConfig } from '../config.js';
import { ApiClientRepository } from '../repositories/ApiClientRepository.js';
import { ApiClientService } from '../services/ApiClientService.js';
import { createLogger } from '../utils/logger.js';
import { runMigrations } from './migrator.js';
import { createPostgresPool, verifyPostgres } from './pool.js';

function usage() {
  return [
    'Usage:',
    '  npm run client:admin -- list',
    '  npm run client:admin -- create <client-id> <display-name> [rate-limit-per-minute]',
    '  npm run client:admin -- rotate <client-id>',
    '  npm run client:admin -- disable <client-id>',
  ].join('\n');
}

async function runCommand(service, repository, args) {
  const [command, clientId, displayName, rateLimitRaw] = args;

  if (command === 'list' && args.length === 1) {
    return { clients: await repository.list() };
  }
  if (command === 'create' && clientId && displayName) {
    const rateLimitPerMinute = rateLimitRaw === undefined ? 600 : Number(rateLimitRaw);
    return service.createClient({ clientId, displayName, rateLimitPerMinute });
  }
  if (command === 'rotate' && clientId && args.length === 2) {
    const result = await service.rotateClientSecret(clientId);
    if (!result) throw new Error(`Client not found: ${clientId}`);
    return result;
  }
  if (command === 'disable' && clientId && args.length === 2) {
    const client = await service.disableClient(clientId);
    if (!client) throw new Error(`Client not found: ${clientId}`);
    return { client };
  }
  throw new Error(usage());
}

async function main() {
  const config = loadConfig();
  if (!config.database.enabled) throw new Error('DATABASE_URL is required');

  const logger = createLogger({ level: config.logLevel });
  const pool = createPostgresPool(config.database, logger);
  try {
    await verifyPostgres(pool);
    await runMigrations(pool, logger);
    const repository = new ApiClientRepository(pool);
    const service = new ApiClientService(repository, config.clientSecretMasterKey);
    const result = await runCommand(service, repository, process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  createLogger().error('client_admin_failed', { error });
  process.exitCode = 1;
}
