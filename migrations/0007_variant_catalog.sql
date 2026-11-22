-- Private, fingerprint-bound reviews. No learning state or frontend schema changes.
CREATE TABLE IF NOT EXISTS account_practice_variant_catalog (
 account_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, reviews TEXT NOT NULL
);
