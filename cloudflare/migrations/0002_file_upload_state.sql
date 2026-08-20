ALTER TABLE files ADD COLUMN uploaded_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_files_version_uploaded
  ON files(version_id, uploaded_at);
