CREATE TABLE IF NOT EXISTS operation_budgets (
  resource TEXT PRIMARY KEY,
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK(reserved_bytes >= 0),
  day TEXT NOT NULL DEFAULT '',
  writes INTEGER NOT NULL DEFAULT 0,
  export_reads INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO operation_budgets(resource) VALUES ('quickshare'), ('imgbed');
