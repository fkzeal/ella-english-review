CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  enrollment_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  approved INTEGER NOT NULL DEFAULT 0 CHECK (approved IN (0,1))
);
CREATE TABLE IF NOT EXISTS questions (
  fingerprint TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS answers (
  device_id TEXT NOT NULL REFERENCES devices(id),
  event_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  learning_day TEXT NOT NULL,
  fingerprint TEXT NOT NULL REFERENCES questions(fingerprint),
  selected INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  help INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live','backfill','imported')),
  origin_device_id TEXT,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (device_id,event_id)
);
CREATE INDEX IF NOT EXISTS answers_device_time ON answers(device_id,occurred_at,event_id);
