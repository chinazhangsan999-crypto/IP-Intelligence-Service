import { execFile } from 'node:child_process';
import { access, constants, readdir, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { DATA_SOURCE_UNITS, DATA_SOURCE_UNIT_IDS, publicDataSourceCatalog } from '../data/dataSourceCatalog.js';

const execFileAsync = promisify(execFile);
const FORCE_DOWNLOAD_RESERVE_BYTES = 512 * 1024 * 1024;

async function directoryBytes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return directoryBytes(target);
    if (!entry.isFile()) return 0;
    return (await stat(target)).size;
  }));
  return sizes.reduce((total, size) => total + size, 0);
}

async function directoryWritable(directory) {
  try {
    await access(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function runScript(scriptPath, cwd, signal, args = [], env = process.env) {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd,
    windowsHide: true,
    timeout: 20 * 60 * 1_000,
    maxBuffer: 1024 * 1024,
    signal,
    env,
  });
  const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return lastLine ? JSON.parse(lastLine) : {};
}

export class DataUpdateScheduler {
  constructor({
    enabled,
    intervalMs,
    startupDelayMs,
    cwd,
    dataDir = null,
    logger,
    repository = null,
    reloadSources,
    execute = runScript,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    metrics = null,
    ip2ProxyAutoUpdateEnabled = false,
    sapicsAutoUpdateEnabled = false,
    validateSources = null,
    credentialProvider = null,
    writableCheck = directoryWritable,
  }) {
    this.enabled = enabled;
    this.intervalMs = intervalMs;
    this.startupDelayMs = startupDelayMs;
    this.cwd = cwd;
    this.dataDir = dataDir || path.join(cwd, 'data');
    this.logger = logger;
    this.repository = repository;
    this.reloadSources = reloadSources;
    this.execute = execute;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.metrics = metrics;
    this.ip2ProxyAutoUpdateEnabled = ip2ProxyAutoUpdateEnabled;
    this.sapicsAutoUpdateEnabled = sapicsAutoUpdateEnabled;
    this.validateSources = validateSources;
    this.credentialProvider = credentialProvider;
    this.writableCheck = writableCheck;
    this.timer = null;
    this.running = false;
    this.stopped = false;
    this.abortController = null;
    this.currentRun = null;
    this.lastRun = null;
    this.currentRunState = null;
  }

  snapshot() {
    return {
      enabled: this.enabled,
      running: this.running,
      last_run: this.lastRun ? { ...this.lastRun } : null,
      current_run: this.currentRunState ? { ...this.currentRunState } : null,
    };
  }

  async managementSnapshot() {
    const [configs, versions] = await Promise.all([
      this.repository?.listDataSourceConfigs?.() || [],
      this.repository?.listDataSourceVersions?.() || [],
    ]);
    const configById = new Map(configs.map((config) => [config.source_id, config]));
    const versionById = new Map(versions.map((version) => [version.source_id, version]));
    return publicDataSourceCatalog().map((unit) => ({
      ...unit,
      config: configById.get(unit.id) || {
        source_id: unit.id,
        display_name: unit.displayName,
        ...unit.defaults,
      },
      members: unit.members.map((member) => ({ ...member, state: versionById.get(member.id) || null })),
    }));
  }

  async forceDownloadPreflight() {
    const sources = await this.managementSnapshot();
    const enabledSources = sources.filter((source) => source.config?.enabled !== false);
    const dataDirectory = this.dataDir;
    const [currentBytes, filesystem, dataDirectoryWritable] = await Promise.all([
      directoryBytes(dataDirectory).catch(() => 0),
      statfs(dataDirectory).catch(() => null),
      this.writableCheck(dataDirectory),
    ]);
    const freeBytes = filesystem ? Number(filesystem.bavail) * Number(filesystem.bsize) : null;
    const estimatedTemporaryBytes = Math.ceil(currentBytes * 1.25) + FORCE_DOWNLOAD_RESERVE_BYTES;
    return {
      enabled_group_count: enabledSources.length,
      enabled_file_count: enabledSources.reduce((count, source) => count + source.members.length, 0),
      disabled_groups: sources.filter((source) => source.config?.enabled === false).map((source) => source.id),
      current_data_bytes: currentBytes,
      free_bytes: freeBytes,
      estimated_temporary_bytes: estimatedTemporaryBytes,
      enough_disk: freeBytes === null ? null : freeBytes >= estimatedTemporaryBytes,
      data_directory_writable: dataDirectoryWritable,
      warnings: [
        ...(!dataDirectoryWritable ? ['数据目录不可写，服务无法保存新数据库。请先修复服务器数据目录权限。'] : []),
        ...(enabledSources.some((source) => source.id === 'ip2proxy')
          ? ['IP2Proxy 官方可能限制每日下载次数，无法在下载前读取剩余配额。']
          : []),
      ],
    };
  }

  recordRun(status, startedAt, details = {}) {
    this.lastRun = {
      status,
      started_at: startedAt.toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt.getTime(),
      ...details,
    };
    this.metrics?.observeDataUpdate?.(status);
  }

  schedule(delayMs) {
    if (!this.enabled || this.stopped) return;
    this.timer = this.setTimer(() => {
      this.currentRun = this.runCycle().finally(() => {
        this.currentRun = null;
        this.schedule(this.intervalMs);
      });
    }, delayMs);
    this.timer?.unref?.();
  }

  start() {
    this.schedule(this.startupDelayMs);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.abortController?.abort();
    await this.currentRun?.catch(() => {});
  }

  async runCycle(options = {}) {
    if (this.running || this.stopped) return { started: false, reason: 'not_available' };
    this.running = true;
    this.abortController = new AbortController();
    let job = null;
    let releaseUpdateLock = null;
    const startedAt = new Date();
    try {
      if (this.repository?.acquireDataUpdateLock) {
        releaseUpdateLock = await this.repository.acquireDataUpdateLock();
        if (!releaseUpdateLock) {
          this.recordRun('skipped', startedAt, { reason: 'another_instance_updating' });
          return { started: false, reason: 'another_instance_updating' };
        }
      }
      const trigger = options.trigger || 'scheduler';
      job = await this.repository?.startUpdateJob?.({
        sourceId: options.unitIds?.length === 1 ? options.unitIds[0] : 'all-data-sources',
        targetVersion: startedAt.toISOString(),
        details: { trigger, force: options.force === true },
      });
      if (!await this.writableCheck(this.dataDir)) {
        throw new Error(`数据目录不可写：${this.dataDir}。请检查宿主机目录所有者，服务用户需要写权限。`);
      }
      const results = {};
      const requestedIds = options.unitIds?.length ? options.unitIds : null;
      if (requestedIds?.some((id) => !DATA_SOURCE_UNIT_IDS.has(id))) {
        throw new Error('Unknown data source update unit');
      }
      const storedConfigs = await this.repository?.listDataSourceConfigs?.() || [];
      const configById = new Map(storedConfigs.map((config) => [config.source_id, config]));
      const operations = DATA_SOURCE_UNITS.filter((unit) => {
        const stored = configById.get(unit.id);
        const enabled = stored ? stored.enabled : unit.defaultEnabled;
        if (!enabled) return false;
        if (requestedIds) return requestedIds.includes(unit.id);
        if (trigger === 'manual') return true;
        const autoEnabled = stored ? stored.auto_update_enabled : (
          unit.id === 'ip2proxy' ? this.ip2ProxyAutoUpdateEnabled
            : unit.id === 'sapics' ? this.sapicsAutoUpdateEnabled
              : unit.defaultAutoUpdate
        );
        if (!autoEnabled) return false;
        const lastUpdateAt = Date.parse(stored?.last_update_at || '');
        const intervalHours = Number(stored?.interval_hours || unit.defaultIntervalHours);
        return !Number.isFinite(lastUpdateAt) || Date.now() - lastUpdateAt >= intervalHours * 60 * 60 * 1_000;
      });
      this.currentRunState = {
        source_id: job?.source_id || (requestedIds?.join(',') || 'all-data-sources'),
        trigger,
        total: operations.length,
        completed: 0,
        current: null,
        started_at: startedAt.toISOString(),
      };
      for (const unit of operations) {
        const name = unit.id;
        const scriptPath = path.join(this.cwd, 'scripts', unit.script);
        this.currentRunState.current = name;
        try {
          const args = [
            ...(unit.scriptArgs || []),
            ...(options.force === true ? ['--force'] : []),
          ];
          const credentials = await this.credentialProvider?.(name) || {};
          const env = { ...process.env, ...credentials };
          const result = await this.execute(scriptPath, this.cwd, this.abortController.signal, args, env);
          if (result?.status === 'failed') throw new Error(result.error || `${name} data update did not install any valid source`);
          results[name] = {
            status: 'succeeded',
            result,
          };
          const memberFailures = (result?.sources || []).filter((source) => source?.status === 'failed');
          for (const source of result?.sources || []) {
            if (!source?.id) continue;
            await this.repository?.upsertDataSource?.({
              id: source.id,
              status: source.status === 'failed' ? 'unavailable' : 'ready',
              required: false,
              version: source.version || result.version || null,
              fileChecksum: source.sha256 || source.file_checksum || null,
              updatedAt: source.updated_at || new Date().toISOString(),
              expiresAt: source.expires_at || null,
              lastError: source.error || null,
              metadata: {
                file: source.file || null,
                bytes: source.bytes ?? source.size ?? null,
                records: source.records ?? null,
                license: source.license || null,
              },
            });
          }
          const groupError = memberFailures.length > 0
            ? memberFailures.map((source) => `${source.id}: ${source.error || '更新失败'}`).join('; ').slice(0, 2_000)
            : null;
          await this.repository?.markDataSourceUpdate?.(name, {
            status: memberFailures.length > 0 ? 'failed' : 'succeeded',
            error: groupError,
          })
            ?.catch?.((error) => this.logger.error('data_source_status_write_failed', { source_id: name, error }));
        } catch (error) {
          results[name] = { status: 'failed', error: String(error.message || error).slice(0, 2_000) };
          await this.repository?.markDataSourceUpdate?.(name, { status: 'failed', error: results[name].error })
            ?.catch?.((repositoryError) => this.logger.error('data_source_status_write_failed', { source_id: name, error: repositoryError }));
        } finally {
          this.currentRunState.completed += 1;
        }
      }
      const hasSuccess = Object.values(results).some((result) => result.status === 'succeeded');
      const sources = hasSuccess ? await this.reloadSources(results) : [];
      let validation = null;
      if (hasSuccess && options.validateAfterUpdate === true && this.validateSources) {
        try {
          validation = await this.validateSources();
        } catch (error) {
          validation = { passed: false, error: String(error.message || error).slice(0, 2_000) };
        }
      }
      const details = {
        results,
        sources,
        validation,
        skipped_disabled: DATA_SOURCE_UNITS
          .filter((unit) => !operations.some((operation) => operation.id === unit.id))
          .filter((unit) => configById.get(unit.id)?.enabled === false)
          .map((unit) => unit.id),
        duration_ms: Date.now() - startedAt.getTime(),
      };
      const failed = Object.entries(results).filter(([, result]) => result.status === 'failed');
      if (failed.length > 0) {
        const errorMessage = failed.map(([name, result]) => `${name}: ${result.error}`).join('; ');
        if (job) await this.repository.finishUpdateJob(job.id, {
          status: 'failed', errorMessage, details,
        });
        this.recordRun('failed', startedAt, { error: errorMessage });
        this.logger.error('data_update_failed', { error: errorMessage, ...details });
        return { started: true, status: 'failed', error: errorMessage, details };
      }
      if (job) await this.repository.finishUpdateJob(job.id, { status: 'succeeded', details });
      this.recordRun('succeeded', startedAt);
      this.logger.info('data_update_completed', details);
      return { started: true, status: 'succeeded', details };
    } catch (error) {
      const details = { duration_ms: Date.now() - startedAt.getTime() };
      if (job) {
        await this.repository.finishUpdateJob(job.id, {
          status: 'failed',
          errorMessage: String(error.message || error).slice(0, 2_000),
          details,
        }).catch((repositoryError) => this.logger.error('data_update_job_finish_failed', { error: repositoryError }));
      }
      this.recordRun('failed', startedAt, { error: String(error.message || error).slice(0, 2_000) });
      this.logger.error('data_update_failed', { error, ...details });
      return { started: true, status: 'failed', error: error.message };
    } finally {
      if (releaseUpdateLock) {
        await releaseUpdateLock().catch((error) => this.logger.error('data_update_unlock_failed', { error }));
      }
      this.running = false;
      this.abortController = null;
      this.currentRunState = null;
    }
  }
}
