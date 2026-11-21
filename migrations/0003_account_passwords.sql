CREATE TABLE IF NOT EXISTS account_credentials (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  password_hash TEXT NOT NULL,
  initialized_at TEXT NOT NULL
);
INSERT OR IGNORE INTO account_credentials(account_id,password_hash,initialized_at)
SELECT a.id,a.code_hash,COALESCE(a.updated_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
FROM accounts a
WHERE a.code_hash<>'' AND (
  a.bundle IS NOT NULL OR a.revision>0 OR
  EXISTS(SELECT 1 FROM account_sessions s WHERE s.account_id=a.id)
);
