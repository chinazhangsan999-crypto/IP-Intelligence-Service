CREATE TABLE data_source_configs (
  source_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_update_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  interval_hours INTEGER NOT NULL DEFAULT 24 CHECK (interval_hours BETWEEN 1 AND 744),
  last_update_at TIMESTAMPTZ,
  last_update_status TEXT CHECK (last_update_status IN ('succeeded', 'failed')),
  last_error TEXT,
  updated_by BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_data_source_configs_auto_update
  ON data_source_configs(enabled, auto_update_enabled, source_id);
