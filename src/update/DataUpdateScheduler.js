import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runScript(scriptPath, cwd, signal) {
  const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
    cwd,
    windowsHide: true,
    timeout: 10 * 60 * 1_000,
    maxBuffer: 1024 * 1024,
    signal,
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
    logger,
    repository = null,
    reloadSources,
    execute = runScript,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    metrics = null,
    ip2ProxyAutoUpdateEnabled = false,
  }) {
    this.enabled = enabled;
    this.intervalMs = intervalMs;
    this.startupDelayMs = startupDelayMs;
    this.cwd = cwd;
    this.logger = logger;
    this.repository = repository;
    this.reloadSources = reloadSources;
    this.execute = execute;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.metrics = metrics;
    this.ip2ProxyAutoUpdateEnabled = ip2ProxyAutoUpdateEnabled;
    this.timer = null;
    this.running = false;
    this.stopped = false;
    this.abortController = null;
    this.currentRun = null;
    this.lastRun = null;
  }

  snapshot() {
    return {
      enabled: this.enabled,
      running: this.running,
      last_run: this.lastRun ? { ...this.lastRun } : null,
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

  async runCycle() {
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
      job = await this.repository?.startUpdateJob({
        sourceId: 'automatic-data-update',
        targetVersion: startedAt.toISOString(),
        details: { trigger: 'scheduler' },
      });
      const results = {};
      const operations = [
        ['dbip', path.join(this.cwd, 'scripts', 'update-dbip-data.js')],
        ['open', path.join(this.cwd, 'scripts', 'update-open-data.js')],
      ];
      if (this.ip2ProxyAutoUpdateEnabled) {
        operations.push(['ip2proxy', path.join(this.cwd, 'scripts', 'update-ip2proxy-data.js')]);
      }
      for (const [name, scriptPath] of operations) {
        try {
          results[name] = {
            status: 'succeeded',
            result: await this.execute(scriptPath, this.cwd, this.abortController.signal),
          };
        } catch (error) {
          results[name] = { status: 'failed', error: String(error.message || error).slice(0, 2_000) };
        }
      }
      const hasSuccess = Object.values(results).some((result) => result.status === 'succeeded');
      const sources = hasSuccess ? await this.reloadSources(results) : [];
      const details = { results, sources, duration_ms: Date.now() - startedAt.getTime() };
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
    }
  }
}
