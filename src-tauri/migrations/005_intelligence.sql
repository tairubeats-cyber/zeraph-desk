-- Finance phase 3: what the user has done about each finding.
--
-- Findings themselves are recomputed from the data every time; only their state
-- is kept, so a dismissal survives a restart and the Activity feed can say when
-- something was first noticed. Preferences live in the existing `settings`
-- table under the key fin_preferences.

CREATE TABLE IF NOT EXISTS fin_insights (
  id            TEXT PRIMARY KEY,          -- stable per thing and period, e.g. budget-over:dining:2026-09
  detector      TEXT NOT NULL,
  severity      TEXT NOT NULL,             -- attention | notice
  category      TEXT NOT NULL,             -- notification category
  title         TEXT NOT NULL,             -- as first shown, so the Activity feed can read back
  summary       TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',   -- open | dismissed | resolved
  read          INTEGER NOT NULL DEFAULT 0,
  notif_hidden  INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fin_insights_status ON fin_insights(status, first_seen_at DESC);
