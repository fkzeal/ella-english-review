CREATE TABLE IF NOT EXISTS maintenance_head (
  id INTEGER PRIMARY KEY CHECK (id=1),
  revision TEXT,
  manifest TEXT,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO maintenance_head(id) VALUES(1);
CREATE TABLE IF NOT EXISTS maintenance_chunks (
  revision TEXT NOT NULL,
  part INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY(revision,part)
);
CREATE TABLE IF NOT EXISTS maintenance_receipts (
  run_id TEXT PRIMARY KEY,
  receipt TEXT NOT NULL
);
