CREATE TABLE IF NOT EXISTS transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT    NOT NULL CHECK (type IN ('Deposit', 'Withdrawal')),
  amount_centavos INTEGER NOT NULL CHECK (amount_centavos > 0),
  balance_after   INTEGER NOT NULL CHECK (balance_after >= 0)
);
