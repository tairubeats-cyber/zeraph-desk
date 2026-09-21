-- The store. One file on the owner's machine. Everything reads and writes here.

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  email       TEXT,
  phone       TEXT,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS threads (
  id              TEXT PRIMARY KEY,
  contact_id      TEXT NOT NULL REFERENCES contacts(id),
  channel         TEXT NOT NULL,
  subject         TEXT NOT NULL,
  intent          TEXT NOT NULL DEFAULT 'unknown',
  status          TEXT NOT NULL DEFAULT 'open',
  last_message_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id             TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL REFERENCES threads(id),
  direction      TEXT NOT NULL,
  body           TEXT NOT NULL,
  sent_at        TEXT NOT NULL,
  from_action_id TEXT
);

-- v1 grounding: the business facts sheet, stored as one JSON row.
-- When a customer's sheet stops fitting the prompt, that's when documents and
-- chunks come back.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  thread_id      TEXT REFERENCES threads(id),
  rationale      TEXT NOT NULL,
  payload        TEXT NOT NULL,   -- JSON
  citations      TEXT NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TEXT NOT NULL,
  decided_at     TEXT,
  decline_reason TEXT
);

-- Append-only. Phase 3 dashboard and Phase 4 recipes both read from here.
CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  subject_id TEXT,
  at         TEXT NOT NULL,
  meta       TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status, created_at);
CREATE INDEX IF NOT EXISTS idx_threads_last   ON threads(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_at      ON events(at DESC);
