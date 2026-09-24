-- Finance area, phase 1. Only what the user themselves decides lives here:
-- their categories and their edits to transactions. Account and transaction
-- data comes from a provider (see src/lib/finance/provider.ts) and is never
-- copied into these tables.

CREATE TABLE IF NOT EXISTS fin_categories (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  kind     TEXT NOT NULL,            -- income | expense | transfer
  position INTEGER NOT NULL,
  hidden   INTEGER NOT NULL DEFAULT 0
);

-- One row per transaction the user has touched. No row means "as the provider sent it".
CREATE TABLE IF NOT EXISTS fin_tx_overrides (
  tx_id       TEXT PRIMARY KEY,
  category_id TEXT,
  note        TEXT NOT NULL DEFAULT '',
  flagged     INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);
