-- The banking rules live here, so no caller (Nim, a script, a console) can bypass them.
-- The error text in RAISE() is a stable code that the Nim API maps to a friendly message.

DROP TRIGGER IF EXISTS trg_tx_before;
CREATE TRIGGER trg_tx_before BEFORE INSERT ON transactions
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNT_NOT_FOUND')
    WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE id = NEW.account_id);

  -- A frozen account can still receive money but cannot send any.
  SELECT RAISE(ABORT, 'ACCOUNT_FROZEN')
    WHERE NEW.kind IN ('Withdrawal', 'Transfer Out')
      AND (SELECT status FROM accounts WHERE id = NEW.account_id) = 'frozen';

  SELECT RAISE(ABORT, 'INSUFFICIENT_FUNDS')
    WHERE NEW.kind IN ('Withdrawal', 'Transfer Out')
      AND NEW.amount > (SELECT balance FROM accounts WHERE id = NEW.account_id);

  SELECT RAISE(ABORT, 'DAILY_LIMIT')
    WHERE NEW.kind IN ('Withdrawal', 'Transfer Out')
      AND NEW.amount + COALESCE((SELECT SUM(amount) FROM transactions
                                  WHERE account_id = NEW.account_id
                                    AND kind IN ('Withdrawal', 'Transfer Out')
                                    AND date(created_at) = date('now', 'localtime')), 0)
          > (SELECT daily_limit FROM accounts WHERE id = NEW.account_id);
END;

DROP TRIGGER IF EXISTS trg_tx_after;
CREATE TRIGGER trg_tx_after AFTER INSERT ON transactions
BEGIN
  UPDATE accounts
     SET balance = balance + CASE WHEN NEW.kind IN ('Deposit', 'Transfer In')
                                  THEN NEW.amount ELSE -NEW.amount END
   WHERE id = NEW.account_id;

  UPDATE transactions
     SET balance_after = (SELECT balance FROM accounts WHERE id = NEW.account_id)
   WHERE id = NEW.id;

  INSERT INTO audit_log (user_id, action, detail)
  VALUES ((SELECT user_id FROM accounts WHERE id = NEW.account_id),
          NEW.kind,
          (SELECT number FROM accounts WHERE id = NEW.account_id) || ' amount=' || NEW.amount);
END;

-- The ledger is append-only: history can never be edited or deleted.
DROP TRIGGER IF EXISTS trg_tx_no_delete;
CREATE TRIGGER trg_tx_no_delete BEFORE DELETE ON transactions
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE');
END;

DROP TRIGGER IF EXISTS trg_tx_no_update;
CREATE TRIGGER trg_tx_no_update BEFORE UPDATE OF account_id, kind, amount, counterparty, note, created_at ON transactions
BEGIN
  SELECT RAISE(ABORT, 'LEDGER_IMMUTABLE');
END;
