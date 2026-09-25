-- Finance phase 6: data the person brought in, and OS notification tracking.
--
-- Imported accounts, transactions and balances are the app's own record of what
-- the person imported from their bank's files. They are read only by the
-- "imported files" provider; the sample provider never touches them. Removing
-- imported data empties these tables and the app goes back to the sample.

CREATE TABLE IF NOT EXISTS fin_src_accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,             -- an AccountKind
  institution   TEXT NOT NULL,             -- as the person typed it
  mask          TEXT,                      -- last four digits, optional
  balance_cents INTEGER NOT NULL,          -- the latest balance on record; owed amounts are positive
  created_at    TEXT NOT NULL
);

-- One balance per account per day: what the person entered, or the file's balance column.
-- This is where balance history comes from for imported accounts.
CREATE TABLE IF NOT EXISTS fin_src_balances (
  account_id    TEXT NOT NULL,
  date          TEXT NOT NULL,
  balance_cents INTEGER NOT NULL,
  PRIMARY KEY (account_id, date)
);

-- The id is a hash of the row's account, date, amount and description (see assignIds in csv.ts),
-- so importing the same file twice adds nothing the second time.
CREATE TABLE IF NOT EXISTS fin_src_transactions (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  date          TEXT NOT NULL,
  merchant      TEXT NOT NULL,
  description   TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL,          -- negative is money out
  category_hint TEXT,
  batch_id      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fin_src_tx_account ON fin_src_transactions(account_id, date DESC);

CREATE TABLE IF NOT EXISTS fin_src_imports (
  id         TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  at         TEXT NOT NULL,
  file_name  TEXT NOT NULL,
  rows_total INTEGER NOT NULL,
  added      INTEGER NOT NULL,
  skipped    INTEGER NOT NULL,             -- already there
  invalid    INTEGER NOT NULL              -- couldn't be read
);

-- Whether a finding has already been shown as a system notification, so it is shown once.
ALTER TABLE fin_insights ADD COLUMN os_notified INTEGER NOT NULL DEFAULT 0;
