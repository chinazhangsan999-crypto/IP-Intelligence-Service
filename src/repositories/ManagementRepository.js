export class ManagementRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async recordUsage({ apiClientId, bucketStart, requests, ips, successes, errors }) {
    await this.pool.query(
      `INSERT INTO api_usage_hourly (
         api_client_id, bucket_start, request_count, ip_count, success_count, error_count
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (api_client_id, bucket_start) DO UPDATE SET
         request_count = api_usage_hourly.request_count + EXCLUDED.request_count,
         ip_count = api_usage_hourly.ip_count + EXCLUDED.ip_count,
         success_count = api_usage_hourly.success_count + EXCLUDED.success_count,
         error_count = api_usage_hourly.error_count + EXCLUDED.error_count,
         updated_at = NOW()`,
      [apiClientId, bucketStart, requests, ips, successes, errors],
    );
  }

  async acquireDataUpdateLock() {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT pg_try_advisory_lock(1647913201) AS acquired');
      if (result.rows[0]?.acquired !== true) {
        client.release();
        return null;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await client.query('SELECT pg_advisory_unlock(1647913201)');
        } finally {
          client.release();
        }
      };
    } catch (error) {
      client.release();
      throw error;
    }
  }

  async upsertDataSource(source) {
    const result = await this.pool.query(
      `INSERT INTO data_source_versions (
         source_id, status, required, version, file_checksum,
         updated_at, expires_at, last_checked_at, last_error, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9)
       ON CONFLICT (source_id) DO UPDATE SET
         status = EXCLUDED.status,
         required = EXCLUDED.required,
         version = EXCLUDED.version,
         file_checksum = COALESCE(EXCLUDED.file_checksum, data_source_versions.file_checksum),
         updated_at = EXCLUDED.updated_at,
         expires_at = EXCLUDED.expires_at,
         last_checked_at = NOW(),
         last_error = EXCLUDED.last_error,
         metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        source.id,
        source.status,
        source.required,
        source.version,
        source.fileChecksum,
        source.updatedAt,
        source.expiresAt,
        source.lastError,
        source.metadata || {},
      ],
    );
    return result.rows[0];
  }

  async listEnabledClassificationRules() {
    const result = await this.pool.query(
      `SELECT id, name, priority, match_type, match_value, network_type,
              flags, confidence, updated_at
         FROM network_classification_rules
        WHERE enabled = TRUE
        ORDER BY priority DESC, id ASC`,
    );
    return result.rows;
  }

  async listClassificationRules() {
    const result = await this.pool.query(
      `SELECT id, name, priority, match_type, match_value, network_type,
              flags, confidence, enabled, created_at, updated_at
         FROM network_classification_rules
        ORDER BY priority DESC, id ASC`,
    );
    return result.rows;
  }

  async setClassificationRuleEnabled(id, enabled) {
    const result = await this.pool.query(
      `UPDATE network_classification_rules
          SET enabled = $2, updated_at = NOW()
        WHERE id = $1
      RETURNING id, name, priority, match_type, match_value, network_type,
                flags, confidence, enabled, created_at, updated_at`,
      [id, enabled],
    );
    return result.rows[0] || null;
  }

  async getAdminManagementSnapshot() {
    const [usage, jobs, audits, feedback] = await Promise.all([
      this.pool.query(
        `SELECT c.client_id, c.display_name,
                COALESCE(SUM(u.request_count), 0)::bigint AS request_count,
                COALESCE(SUM(u.ip_count), 0)::bigint AS ip_count,
                COALESCE(SUM(u.error_count), 0)::bigint AS error_count
           FROM api_clients c
           LEFT JOIN api_usage_hourly u ON u.api_client_id = c.id
            AND u.bucket_start >= NOW() - INTERVAL '24 hours'
          GROUP BY c.id
          ORDER BY c.created_at ASC`,
      ),
      this.pool.query(
        `SELECT id, source_id, status, target_version, started_at, completed_at,
                error_message
           FROM update_jobs
          ORDER BY started_at DESC
          LIMIT 20`,
      ),
      this.pool.query(
        `SELECT a.id, c.client_id, a.event_type, a.outcome, a.request_id,
                a.metadata, a.created_at
           FROM audit_logs a
           LEFT JOIN api_clients c ON c.id = a.api_client_id
          ORDER BY a.created_at DESC
          LIMIT 40`,
      ),
      this.pool.query(
        `SELECT f.id, c.client_id, f.reported_fields, f.notes, f.status,
                f.resolution, f.created_at, f.updated_at
           FROM lookup_feedback f
           LEFT JOIN api_clients c ON c.id = f.api_client_id
          ORDER BY f.created_at DESC
          LIMIT 30`,
      ),
    ]);
    return {
      usage_24h: usage.rows,
      update_jobs: jobs.rows,
      audit_logs: audits.rows,
      feedback: feedback.rows,
    };
  }

  async saveClassificationRule(rule) {
    const result = await this.pool.query(
      `INSERT INTO network_classification_rules (
         name, priority, match_type, match_value, network_type,
         flags, confidence, enabled
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (name) DO UPDATE SET
         priority = EXCLUDED.priority,
         match_type = EXCLUDED.match_type,
         match_value = EXCLUDED.match_value,
         network_type = EXCLUDED.network_type,
         flags = EXCLUDED.flags,
         confidence = EXCLUDED.confidence,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()
       RETURNING *`,
      [
        rule.name,
        rule.priority,
        rule.matchType,
        rule.matchValue,
        rule.networkType,
        rule.flags || {},
        rule.confidence,
        rule.enabled !== false,
      ],
    );
    return result.rows[0];
  }

  async startUpdateJob({ sourceId, targetVersion, details = {} }) {
    const result = await this.pool.query(
      `INSERT INTO update_jobs (source_id, status, target_version, details)
       VALUES ($1, 'running', $2, $3)
       RETURNING *`,
      [sourceId, targetVersion, details],
    );
    return result.rows[0];
  }

  async finishUpdateJob(id, { status, errorMessage = null, details = {} }) {
    const result = await this.pool.query(
      `UPDATE update_jobs
          SET status = $2, error_message = $3, details = $4, completed_at = NOW()
        WHERE id = $1 AND status = 'running'
      RETURNING *`,
      [id, status, errorMessage, details],
    );
    return result.rows[0] || null;
  }

  async recordAudit({ apiClientId = null, eventType, outcome, requestId = null, ipHash = null, metadata = {} }) {
    await this.pool.query(
      `INSERT INTO audit_logs (
         api_client_id, event_type, outcome, request_id, ip_hash, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [apiClientId, eventType, outcome, requestId, ipHash, metadata],
    );
  }

  async createFeedback({ apiClientId = null, inputHash, reportedFields, notes = null }) {
    const result = await this.pool.query(
      `INSERT INTO lookup_feedback (
         api_client_id, input_hash, reported_fields, notes
       ) VALUES ($1, $2, $3, $4)
       RETURNING id, api_client_id, input_hash, reported_fields, notes,
                 status, resolution, created_at, updated_at`,
      [apiClientId, inputHash, reportedFields, notes],
    );
    return result.rows[0];
  }

  async resolveFeedback(id, { status, resolution = null }) {
    const result = await this.pool.query(
      `UPDATE lookup_feedback
          SET status = $2, resolution = $3, updated_at = NOW()
        WHERE id = $1
      RETURNING id, api_client_id, input_hash, reported_fields, notes,
                status, resolution, created_at, updated_at`,
      [id, status, resolution],
    );
    return result.rows[0] || null;
  }
}
