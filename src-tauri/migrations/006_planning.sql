-- Finance phase 4: planning. Only what the user enters or decides lives here.
-- Forecasts, payoff estimates and scenario results are recomputed every time.

-- What a debt costs and how it's paid. Entered by the user; a provider that
-- knows these would fill the same shape.
CREATE TABLE IF NOT EXISTS fin_debt_terms (
  account_id        TEXT PRIMARY KEY,
  apr_bps           INTEGER,               -- 19.99% is 1999; NULL = not entered
  min_payment_cents INTEGER,
  payment_cents     INTEGER,               -- NULL = pays the minimum
  due_day           INTEGER,               -- 1 to 31
  updated_at        TEXT NOT NULL
);

-- Things counted in net worth that aren't accounts (a home, a car, a loan from
-- family), each with the dated values the user has entered.
CREATE TABLE IF NOT EXISTS fin_holdings (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL,                -- real_estate | vehicle | other_asset | other_debt
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fin_holding_values (
  holding_id  TEXT NOT NULL,
  date        TEXT NOT NULL,
  value_cents INTEGER NOT NULL,
  PRIMARY KEY (holding_id, date)
);

-- One-off expenses or income the forecast should include.
CREATE TABLE IF NOT EXISTS fin_planned (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  date         TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  direction    TEXT NOT NULL,              -- in | out
  created_at   TEXT NOT NULL
);

-- Saved what-if scenarios. `changes` is JSON: a list of ScenarioChange.
CREATE TABLE IF NOT EXISTS fin_scenarios (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  horizon_months INTEGER NOT NULL,
  changes        TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
