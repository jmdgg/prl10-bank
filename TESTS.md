# Test cases

Automated: `npm test` (20 tests, all passing on 2026-10-21). Each test registers fresh users, so runs don't interfere.

| # | Type | What is checked | Result |
|---|------|-----------------|--------|
| 1 | Success | New account starts at ₱5,000.00 | Pass |
| 2 | Success | Deposit ₱1,500 → balance ₱6,500.00, recorded with balance after | Pass |
| 3 | Success | Withdraw ₱2,000.50 (decimals) → balance ₱2,999.50 | Pass |
| 4 | Invalid | Overdraft rejected (409), balance and history unchanged | Pass |
| 5 | Invalid | `0`, `-50`, `abc`, `12.345`, empty, null, `1e5`, ₱2,000,000 rejected for deposit and withdraw | Pass |
| 6 | Invalid | Unauthenticated request → 401; unknown endpoint → 404 | Pass |
| 7 | Invalid | Wrong password → 401; 5 failures lock the user (429) | Pass |
| 8 | Invalid | Weak password, bad username, duplicate username | Pass |
| 9 | Success | Transfer moves money and shows Transfer Out / Transfer In on each side | Pass |
| 10 | Invalid | Failed transfer changes neither account; same-account and unknown-account rejected | Pass |
| 11 | Security | A customer cannot read or use another customer's account | Pass |
| 12 | Rule | Frozen account can receive but not send; unfreeze restores it | Pass |
| 13 | Rule | Daily withdrawal limit enforced by the database | Pass |
| 14 | Security | Admin endpoints are admin-only; audit log records actions | Pass |
| 15 | Invalid | Non-JSON or malformed body → 415 / 400 | Pass |
| 16 | Success | Statement CSV and type-filtered history | Pass |
| 17 | Security | Logout destroys the server-side session | Pass |
| 18 | Search | History search by note, amount and type; `%` and `_` are literal; over-long query → 400 | Pass |
| 19 | Search | Global search spans all my accounts, never another customer's; 401 when signed out; empty query → 400 | Pass |
| 20 | Setup | Demo accounts have fixed numbers (juan `1000-000001`, maria `1000-000002`) on a fresh database | Pass |

Also checked directly in SQL: `DELETE`/`UPDATE` on the ledger → `LEDGER_IMMUTABLE`; an overdraft `INSERT` → `INSUFFICIENT_FUNDS`; setting a negative balance → `CHECK` failure.

## Manual UI run (screenshots to take for submission)
1. Sign in as `juan` → dashboard shows ₱5,000.00.
2. Deposit `-50` → "Amount must be greater than zero."
3. Deposit `1500` → toast, balance ₱6,500.00.
4. Withdraw `99999` → "Insufficient funds…".
5. Withdraw `2000` → ₱4,500.00.
6. History page → rows below; Transfer page → review step.
7. Sign in as `admin` → freeze an account, open the audit log.

## Sample transaction history (from a real run)
```
Date                 Type        Amount (PHP)  Balance (PHP)  Note
2026-10-20 14:19:26  Deposit     5000.00       5000.00        Opening deposit
2026-10-20 14:19:39  Deposit     1500.00       6500.00
2026-10-20 14:19:40  Withdrawal  2000.00       4500.00
```
