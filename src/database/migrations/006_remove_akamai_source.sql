-- Akamai is intentionally no longer part of the managed evidence catalogue.
-- Preserve audit history, but remove live configuration, cached version state and
-- any manual rule association so the retired source cannot affect a lookup.
UPDATE network_classification_rules
   SET source_id = NULL,
       updated_at = NOW()
 WHERE source_id = 'akamai-ranges';

DELETE FROM source_credentials
 WHERE source_id = 'akamai-ranges';

DELETE FROM data_source_versions
 WHERE source_id = 'akamai-official-ranges';

DELETE FROM data_source_configs
 WHERE source_id = 'akamai-ranges';

-- Existing installations persisted the former default as disabled. Enable the
-- public Spamhaus DROP feed and let the normal scheduler refresh it daily.
UPDATE data_source_configs
   SET enabled = TRUE,
       auto_update_enabled = TRUE,
       interval_hours = 24,
       updated_at = NOW()
 WHERE source_id = 'spamhaus-drop';
