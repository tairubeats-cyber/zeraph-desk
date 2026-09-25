-- Finance phase 2: what the user decides about budgets, goals and recurring
-- payments. Detected recurring payments are recomputed from transactions each
-- time; only the user's marks on them, and payments they add by hand, live here.

CREATE TABLE IF NOT EXISTS fin_budgets (
  category_id  TEXT PRIMARY KEY,
  amount_cents INTEGER NOT NULL,          -- per month
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fin_goals (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL,
  target_cents        INTEGER NOT NULL,
  start_cents         INTEGER NOT NULL DEFAULT 0,
  deadline            TEXT,               -- YYYY-MM-DD or NULL
  monthly_plan_cents  INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fin_goal_contributions (
  id           TEXT PRIMARY KEY,
  goal_id      TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  date         TEXT NOT NULL,
  note         TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_goal_contrib_goal ON fin_goal_contributions(goal_id, date);

CREATE TABLE IF NOT EXISTS fin_recurring_marks (
  key       TEXT PRIMARY KEY,             -- see recurringKey() in src/lib/finance/recurring.ts
  status    TEXT NOT NULL DEFAULT 'active',
  necessity TEXT NOT NULL DEFAULT 'unset',
  autopay   TEXT NOT NULL DEFAULT 'unset',
  is_bill   INTEGER                       -- NULL = use the default guess
);

CREATE TABLE IF NOT EXISTS fin_recurring_manual (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  direction    TEXT NOT NULL,             -- in | out
  frequency    TEXT NOT NULL,
  next_date    TEXT NOT NULL,
  category_id  TEXT NOT NULL
);
