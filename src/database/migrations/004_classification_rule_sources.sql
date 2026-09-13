ALTER TABLE network_classification_rules
  ADD COLUMN source_id TEXT;

CREATE INDEX idx_network_rules_source
  ON network_classification_rules(source_id, enabled, priority DESC, id ASC);
