import path from 'node:path';
import { loadConfig } from './config.js';
import { runMigrations } from './database/migrator.js';
import { createPostgresPool, verifyPostgres } from './database/pool.js';
import { installGracefulShutdown } from './lifecycle.js';
import { createReadiness } from './readiness.js';
import { ApiClientRepository } from './repositories/ApiClientRepository.js';
import { ManagementRepository } from './repositories/ManagementRepository.js';
import { AdminAuthRepository } from './repositories/AdminAuthRepository.js';
import { CloudRangeProvider } from './providers/CloudRangeProvider.js';
import { Ip2ProxyProvider } from './providers/Ip2ProxyProvider.js';
import { MmdbProvider } from './providers/MmdbProvider.js';
import { TorExitProvider } from './providers/TorExitProvider.js';
import { ApiClientService } from './services/ApiClientService.js';
import { ClassificationRuleService } from './services/ClassificationRuleService.js';
import { IntelligenceEnricher } from './services/IntelligenceEnricher.js';
import { IpLookupService } from './services/IpLookupService.js';
import { AdminAuthService } from './services/AdminAuthService.js';
import { ReloadableLookupService } from './services/ReloadableLookupService.js';
import { DataUpdateScheduler } from './update/DataUpdateScheduler.js';
import { ClientRateLimiter } from './security/ClientRateLimiter.js';
import { ReplayGuard } from './security/ReplayGuard.js';
import { RequestAuthenticator } from './security/RequestAuthenticator.js';
import { createHttpServer } from './server.js';
import { createLogger } from './utils/logger.js';
import { MetricsRegistry } from './observability/MetricsRegistry.js';
import { loadAdminAssets } from './admin/loadAdminAssets.js';
import { loadPublicAssets } from './public/loadPublicAssets.js';

async function start() {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel });
  const metrics = new MetricsRegistry();
  const adminAssets = await loadAdminAssets(path.resolve(process.cwd(), 'public', 'admin'));
  const publicAssets = await loadPublicAssets(path.resolve(process.cwd(), 'public', 'site'));
  const publicRateLimiter = new ClientRateLimiter({ maxEntries: 50_000 });
  async function loadSupplementalProviders() {
    return Promise.all(config.ipData.sapicsDatasets.map((dataset) => MmdbProvider.load({
      id: dataset.id,
      required: false,
      filePath: dataset.filePath,
      cacheSize: config.ipData.cacheSize,
    })));
  }

  const [cityProvider, asnProvider, cloudProvider, torProvider, proxyProvider, ruleService, supplementalProviders] = await Promise.all([
    MmdbProvider.load({
      id: 'dbip-city',
      filePath: config.ipData.cityPath,
      cacheSize: config.ipData.cacheSize,
    }),
    MmdbProvider.load({
      id: 'dbip-asn',
      filePath: config.ipData.asnPath,
      cacheSize: config.ipData.cacheSize,
    }),
    CloudRangeProvider.load(config.ipData.cloudRangesPath),
    TorExitProvider.load(config.ipData.torExitPath),
    Ip2ProxyProvider.load(config.ipData.ip2ProxyPath),
    ClassificationRuleService.load(config.ipData.classificationRulesPath),
    loadSupplementalProviders(),
  ]);
  const supplementalById = (providers) => new Map(providers.map((provider) => [provider.id, provider]));
  const supplementalFor = (providers, ids) => {
    const sources = supplementalById(providers);
    return ids.map((id) => sources.get(id)).filter(Boolean);
  };
  const intelligenceSources = [
    cityProvider,
    asnProvider,
    cloudProvider,
    torProvider,
    proxyProvider,
    ruleService,
    ...supplementalProviders,
  ];
  const readiness = createReadiness([
    { id: 'postgres', required: true, ready: false, message: 'Not configured' },
    ...intelligenceSources.map((provider) => provider.publicState()),
  ]);
  const lookupService = new ReloadableLookupService(new IpLookupService({
    cityProvider,
    asnProvider,
    countryProviders: supplementalFor(supplementalProviders, [
      'sapics-user-country', 'sapics-server-country', 'sapics-geolite2-country',
      'sapics-dbip-country', 'sapics-iptoasn-country',
    ]),
    cityFallbackProviders: supplementalFor(supplementalProviders, [
      'sapics-geolite2-city-ipv4', 'sapics-geolite2-city-ipv6',
    ]),
    asnProviders: [
      ...supplementalFor(supplementalProviders, [
        'sapics-origin-asn', 'sapics-iptoasn-asn',
      ]),
      asnProvider,
      ...supplementalFor(supplementalProviders, [
        'sapics-geolite2-asn', 'sapics-dbip-asn',
      ]),
    ],
    enricher: new IntelligenceEnricher({
      cloudProvider,
      torProvider,
      proxyProvider,
      ruleService,
    }),
  }));
  let activeCityProvider = cityProvider;
  let activeAsnProvider = asnProvider;
  let activeCloudProvider = cloudProvider;
  let activeTorProvider = torProvider;
  let activeProxyProvider = proxyProvider;
  let activeSupplementalProviders = supplementalProviders;
  const pool = createPostgresPool(config.database, logger);
  let authenticator = null;
  let managementRepository = null;
  let adminAuthService = null;

  if (pool) {
    try {
      await verifyPostgres(pool);
      await runMigrations(pool, logger);
      readiness.set('postgres', { ready: true, message: null });
      const clientRepository = new ApiClientRepository(pool);
      const clientService = new ApiClientService(clientRepository, config.clientSecretMasterKey);
      managementRepository = new ManagementRepository(pool);
      const adminAuthRepository = new AdminAuthRepository(pool);
      adminAuthService = new AdminAuthService(adminAuthRepository);
      const databaseRules = await managementRepository.listEnabledClassificationRules();
      ruleService.replaceRules([...ruleService.rules, ...databaseRules]);
      authenticator = new RequestAuthenticator({
        clientRepository,
        clientService,
        replayGuard: new ReplayGuard({
          ttlSeconds: config.security.nonceTtlSeconds,
          maxEntries: config.security.nonceMaxEntries,
        }),
        rateLimiter: new ClientRateLimiter(),
        auditRepository: managementRepository,
        logger,
        clockSkewSeconds: config.security.hmacClockSkewSeconds,
      });
      for (const provider of intelligenceSources) {
        const source = provider.publicState();
        await managementRepository.upsertDataSource({
          id: source.id,
          status: source.status,
          required: source.required,
          version: source.version,
          fileChecksum: null,
          updatedAt: source.updated_at,
          expiresAt: source.expires_at,
          lastError: source.message,
          metadata: {},
        });
      }
      logger.info('postgres_ready');
    } catch (error) {
      await pool.end();
      throw error;
    }
  } else {
    logger.warn('postgres_disabled', { environment: config.nodeEnv });
  }

  async function reloadFileSources(updateResults = {}) {
    const [nextCity, nextAsn, nextCloud, nextTor, nextProxy, nextSupplementalProviders] = await Promise.all([
      MmdbProvider.load({
        id: 'dbip-city',
        filePath: config.ipData.cityPath,
        cacheSize: config.ipData.cacheSize,
      }),
      MmdbProvider.load({
        id: 'dbip-asn',
        filePath: config.ipData.asnPath,
        cacheSize: config.ipData.cacheSize,
      }),
      CloudRangeProvider.load(config.ipData.cloudRangesPath),
      TorExitProvider.load(config.ipData.torExitPath),
      Ip2ProxyProvider.load(config.ipData.ip2ProxyPath),
      loadSupplementalProviders(),
    ]);
    if (!nextCity.publicState().ready || !nextAsn.publicState().ready) {
      throw new Error('Updated required IP databases failed reload validation');
    }
    activeCityProvider = nextCity;
    activeAsnProvider = nextAsn;
    if (nextCloud.publicState().ready || !activeCloudProvider.publicState().ready) activeCloudProvider = nextCloud;
    if (nextTor.publicState().ready || !activeTorProvider.publicState().ready) activeTorProvider = nextTor;
    const previousProxyProvider = activeProxyProvider;
    if (nextProxy.publicState().ready || !activeProxyProvider.publicState().ready) activeProxyProvider = nextProxy;
    activeSupplementalProviders = nextSupplementalProviders.map((provider, index) => (
      provider.publicState().ready || !activeSupplementalProviders[index]?.publicState().ready
        ? provider
        : activeSupplementalProviders[index]
    ));
    lookupService.swap(new IpLookupService({
      cityProvider: activeCityProvider,
      asnProvider: activeAsnProvider,
      countryProviders: supplementalFor(activeSupplementalProviders, [
        'sapics-user-country', 'sapics-server-country', 'sapics-geolite2-country',
        'sapics-dbip-country', 'sapics-iptoasn-country',
      ]),
      cityFallbackProviders: supplementalFor(activeSupplementalProviders, [
        'sapics-geolite2-city-ipv4', 'sapics-geolite2-city-ipv6',
      ]),
      asnProviders: [
        ...supplementalFor(activeSupplementalProviders, [
          'sapics-origin-asn', 'sapics-iptoasn-asn',
        ]),
        activeAsnProvider,
        ...supplementalFor(activeSupplementalProviders, [
          'sapics-geolite2-asn', 'sapics-dbip-asn',
        ]),
      ],
      enricher: new IntelligenceEnricher({
        cloudProvider: activeCloudProvider,
        torProvider: activeTorProvider,
        proxyProvider: activeProxyProvider,
        ruleService,
      }),
    }));
    const states = [
      activeCityProvider.publicState(),
      activeAsnProvider.publicState(),
      activeCloudProvider.publicState(),
      activeTorProvider.publicState(),
      activeProxyProvider.publicState(),
      ...activeSupplementalProviders.map((provider) => provider.publicState()),
    ];
    const dbipSources = updateResults.dbip?.result?.sources || [];
    const checksumById = {
      'dbip-city': dbipSources.find((source) => source.kind === 'city')?.sha256 || null,
      'dbip-asn': dbipSources.find((source) => source.kind === 'asn')?.sha256 || null,
      'cloud-ranges': updateResults.open?.result?.cloud_sha256 || null,
      'tor-exit': updateResults.open?.result?.tor_sha256 || null,
      'ip2proxy-lite': updateResults.ip2proxy?.result?.sha256 || null,
      ...Object.fromEntries((updateResults.sapics?.result?.sources || []).map((source) => [source.id, source.sha256 || null])),
    };
    for (const activeState of states) {
      readiness.set(activeState.id, activeState);
      if (managementRepository) {
        await managementRepository.upsertDataSource({
          id: activeState.id,
          status: activeState.status,
          required: activeState.required,
          version: activeState.version,
          fileChecksum: checksumById[activeState.id],
          updatedAt: activeState.updated_at,
          expiresAt: activeState.expires_at,
          lastError: activeState.message,
          metadata: { reload: 'automatic' },
        });
      }
    }
    if (previousProxyProvider !== activeProxyProvider) previousProxyProvider.close();
    return states.map((state) => ({ id: state.id, status: state.status, version: state.version }));
  }

  const dataUpdateScheduler = new DataUpdateScheduler({
    enabled: config.ipData.autoUpdateEnabled,
    intervalMs: config.ipData.updateIntervalMs,
    startupDelayMs: config.ipData.updateStartupDelayMs,
    cwd: process.cwd(),
    logger,
    repository: managementRepository,
    reloadSources: reloadFileSources,
    ip2ProxyAutoUpdateEnabled: config.ipData.ip2ProxyAutoUpdateEnabled,
    sapicsAutoUpdateEnabled: config.ipData.sapicsAutoUpdateEnabled,
    metrics,
  });

  const server = createHttpServer({
    config,
    logger,
    readiness,
    authenticator,
    lookupService,
    usageRepository: managementRepository,
    metrics,
    updateScheduler: dataUpdateScheduler,
    databasePool: pool,
    adminAssets,
    publicAssets,
    publicRateLimiter,
    adminAuthService,
    adminRateLimiter: new ClientRateLimiter({ maxEntries: 10_000 }),
  });
  try {
    await new Promise((resolve, reject) => {
      function onError(error) {
        server.removeListener('listening', onListening);
        reject(error);
      }
      function onListening() {
        server.removeListener('error', onError);
        resolve();
      }
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(config.port, config.host);
    });
  } catch (error) {
    if (pool) await pool.end();
    throw error;
  }

  logger.info('server_started', {
    host: config.host,
    port: config.port,
    environment: config.nodeEnv,
  });
  dataUpdateScheduler.start();

  server.on('error', (error) => {
    logger.error('server_error', { error });
  });

  installGracefulShutdown({
    server,
    logger,
    timeoutMs: config.shutdownTimeoutMs,
    cleanup: async () => {
      await dataUpdateScheduler.stop();
      activeProxyProvider.close();
      if (pool) await pool.end();
    },
  });
}

try {
  await start();
} catch (error) {
  const logger = createLogger();
  logger.error('startup_failed', { error });
  process.exitCode = 1;
}
