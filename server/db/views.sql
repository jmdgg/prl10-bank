DROP VIEW IF EXISTS v_statement;
CREATE VIEW v_statement AS
SELECT t.id, t.account_id, a.number AS account_number,
       strftime('%Y-%m', t.created_at) AS month,
       t.created_at, t.kind, t.amount, t.balance_after, t.counterparty, t.note
  FROM transactions t JOIN accounts a ON a.id = t.account_id;

DROP VIEW IF EXISTS v_month_summary;
CREATE VIEW v_month_summary AS
SELECT account_id, month,
       SUM(CASE WHEN kind IN ('Deposit', 'Transfer In') THEN amount ELSE 0 END) AS credits,
       SUM(CASE WHEN kind IN ('Withdrawal', 'Transfer Out') THEN amount ELSE 0 END) AS debits,
       COUNT(*) AS entries
  FROM v_statement GROUP BY account_id, month;

DROP VIEW IF EXISTS v_admin_overview;
CREATE VIEW v_admin_overview AS
SELECT (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers,
       (SELECT COUNT(*) FROM accounts) AS accounts,
       (SELECT COALESCE(SUM(balance), 0) FROM accounts) AS total_deposits,
       (SELECT COUNT(*) FROM accounts WHERE status = 'frozen') AS frozen_accounts,
       (SELECT COUNT(*) FROM transactions WHERE date(created_at) = date('now', 'localtime')) AS transactions_today;
