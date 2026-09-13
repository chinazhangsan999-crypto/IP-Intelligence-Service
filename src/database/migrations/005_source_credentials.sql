CREATE TABLE source_credentials (
  source_id TEXT NOT NULL,
  credential_name TEXT NOT NULL,
  secret_ciphertext BYTEA NOT NULL,
  secret_iv BYTEA NOT NULL,
  secret_auth_tag BYTEA NOT NULL,
  secret_fingerprint CHAR(64) NOT NULL,
  updated_by BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, credential_name),
  CHECK (credential_name ~ '^[a-z0-9_]{1,64}$')
);
