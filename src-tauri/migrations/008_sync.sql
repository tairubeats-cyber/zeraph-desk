-- Finance phase 6b: accounts that come from a SimpleFIN Bridge connection, and a record of each sync.
--
-- Synced accounts live in the same table as imported ones, so everything that reads imported data reads
-- them too. `provider` is NULL for an account the person added by hand and 'simplefin' for one the bridge
-- supplies; `external_id` is the bridge's own id for it. The access URL is NOT here: it lives in the OS keychain.

ALTER TABLE fin_src_accounts ADD COLUMN provider TEXT;
ALTER TABLE fin_src_accounts ADD COLUMN external_id TEXT;
-- Some banks report what is owed as a positive number and some as a negative one; the person chooses
-- when the account is set up. 1 means "positive means owed".
ALTER TABLE fin_src_accounts ADD COLUMN owed_positive INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_src_accounts_external
  ON fin_src_accounts(provider, external_id) WHERE provider IS NOT NULL;

-- One row per sync: when, whether it worked, how many requests it made (the bridge allows about 24 a day), what it said.
CREATE TABLE IF NOT EXISTS fin_sync_runs (
  id       TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  kind     TEXT NOT NULL,             -- 'discover' (looked at the accounts) or 'sync' (fetched transactions)
  at       TEXT NOT NULL,
  ok       INTEGER NOT NULL,          -- 1 if data came back
  complete INTEGER NOT NULL DEFAULT 1, -- 0 if part of the date range couldn't be fetched, so the next sync must cover it again
  requests INTEGER NOT NULL,
  accounts INTEGER NOT NULL,
  added    INTEGER NOT NULL,
  message  TEXT                       -- anything the bridge said needs attention, or why it failed
);
