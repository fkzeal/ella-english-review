CREATE TABLE IF NOT EXISTS account_practice_runs (
 account_id TEXT NOT NULL, run_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 receipt TEXT NOT NULL, PRIMARY KEY(account_id,run_id)
);
CREATE TABLE IF NOT EXISTS account_practice_questions (
 account_id TEXT NOT NULL, question_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
 run_id TEXT NOT NULL, target_key TEXT NOT NULL, generated_day TEXT NOT NULL,
 snapshot TEXT NOT NULL, PRIMARY KEY(account_id,question_id)
);
CREATE INDEX IF NOT EXISTS practice_fingerprint ON account_practice_questions(fingerprint);
