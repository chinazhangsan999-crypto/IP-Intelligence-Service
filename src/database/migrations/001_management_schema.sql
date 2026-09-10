CREATE TABLE api_clients (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  secret_ciphertext BYTEA NOT NULL,
  secret_iv BYTEA NOT NULL,
  secret_auth_tag BYTEA NOT NULL,
  secret_fingerprint CHAR(64) NOT NULL,
  secret_version INTEGER NOT NULL DEFAULT 1 CHECK (secret_version > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  rate_limit_per_minute INTEGER NOT NULL DEFAULT 600 CHECK (rate_limit_per_minute > 0),
  last_used_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (client_id ~ '^[a-z0-9][a-z0-9_-]{2,63}$')
);

CREATE INDEX idx_api_clients_status ON api_clients(status);

CREATE TABLE api_usage_hourly (
  api_client_id BIGINT NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
  bucket_start TIMESTAMPTZ NOT NULL,
  request_count BIGINT NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  ip_count BIGINT NOT NULL DEFAULT 0 CHECK (ip_count >= 0),
  success_count BIGINT NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  error_count BIGINT NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (api_client_id, bucket_start)
);

CREATE INDEX idx_api_usage_hourly_bucket ON api_usage_hourly(bucket_start DESC);

CREATE TABLE data_source_versions (
  source_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('ready', 'stale', 'unavailable')),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  version TEXT,
  file_checksum CHAR(64),
  updated_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_data_source_versions_status ON data_source_versions(status, required);

CREATE TABLE network_classification_rules (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  priority INTEGER NOT NULL DEFAULT 100,
  match_type TEXT NOT NULL CHECK (match_type IN ('asn', 'cidr', 'asn_org')),
  match_value TEXT NOT NULL,
  network_type TEXT NOT NULL CHECK (
    network_type IN ('residential', 'mobile', 'business', 'education', 'government', 'hosting', 'cdn', 'unknown')
  ),
  flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence TEXT NOT NULL DEFAULT 'medium' CHECK (confidence IN ('low', 'medium', 'high')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_network_rules_enabled_priority
  ON network_classification_rules(enabled, priority DESC, id ASC);

CREATE TABLE update_jobs (
  id BIGSERIAL PRIMARY KEY,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  target_version TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_update_jobs_source_started ON update_jobs(source_id, started_at DESC);
CREATE INDEX idx_update_jobs_running ON update_jobs(status) WHERE status = 'running';

CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  api_client_id BIGINT REFERENCES api_clients(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'failure')),
  request_id TEXT,
  ip_hash CHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_client_created ON audit_logs(api_client_id, created_at DESC);
CREATE INDEX idx_audit_logs_event_created ON audit_logs(event_type, created_at DESC);

CREATE TABLE lookup_feedback (
  id BIGSERIAL PRIMARY KEY,
  api_client_id BIGINT REFERENCES api_clients(id) ON DELETE SET NULL,
  input_hash CHAR(64) NOT NULL,
  reported_fields JSONB NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved', 'rejected')),
  resolution JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lookup_feedback_status_created ON lookup_feedback(status, created_at DESC);
