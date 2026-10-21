-- Money is stored as integer centavos (PHP 5,000.00 = 500000) to avoid float rounding.
-- Timestamps are server-local time so "today" and "this month" match the bank's clock.

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 32),
  full_name  TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 80),
  role       TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  salt       TEXT NOT NULL,
  pw_hash    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  number      TEXT NOT NULL UNIQUE,
  kind        TEXT NOT NULL DEFAULT 'Savings' CHECK (kind IN ('Savings', 'Checking')),
  balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen')),
  daily_limit INTEGER NOT NULL DEFAULT 5000000 CHECK (daily_limit > 0),
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  kind          TEXT NOT NULL CHECK (kind IN ('Deposit', 'Withdrawal', 'Transfer In', 'Transfer Out')),
  amount        INTEGER NOT NULL CHECK (amount > 0),
  balance_after INTEGER,            -- filled in by trg_tx_after
  counterparty  TEXT,               -- other account number for transfers
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id, id);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
