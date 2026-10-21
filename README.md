# Tala Bank — demo online banking

A mock banking web app for the "Same Problem, Different Languages" project. No real money moves.

| Layer | Language | Role |
|-------|----------|------|
| Database rules | **SQL** (SQLite) — *Old* | Tables, `CHECK` constraints, triggers (no overdraft, frozen accounts, daily limit, append-only ledger), views (statements, admin overview) |
| Server | **Nim** + Jester — *New* | JSON API, PBKDF2 password hashing, sessions, validation |
| Browser UI | **TypeScript** — *New (extra)* | Single-page app, no framework |

## Run it (Windows, Git Bash)

One-time setup:
```bash
winget install nim.nim
winget install BrechtSanders.WinLibs.POSIX.UCRT   # C compiler Nim needs
nimble install jester nimcrypto db_connector -y
npm install
```
Build and start (from this folder):
```bash
bash build.sh
./server/bank.exe
```
Open <http://localhost:8080>. `server/sqlite3_64.dll` must stay next to `bank.exe`. The server listens on localhost only (set `BIND=0.0.0.0` to change that; `PORT` changes the port).

Demo logins (seeded on first start, test values only):

| Role | Username | Password | Savings account |
|------|----------|----------|-----------------|
| Admin | `admin` | `Admin#2026` | none |
| Customer | `juan` | `Juan#2026` | `1000-000001` |
| Customer | `maria` | `Maria#2026` | `1000-000002` |

The demo account numbers are fixed, so transfers between Juan and Maria work the same on every machine. Accounts opened later get random numbers. Delete `bank.db` to reset everything (an existing database keeps the numbers it was created with).

## How the brief maps to the app
- ₱5,000 starting balance: every new account gets a ₱5,000.00 "Opening deposit".
- Check balance / deposit / withdraw / history / exit: account cards and the Deposit / Withdraw dialogs, the History table, and Sign out.
- Positive amounts only, no overdraft, retry on bad input: checked in the UI, the API and again by SQL triggers.
- Transaction history shows type, amount and balance after each transaction.
- Beyond the brief: sign-in, several accounts, transfers, filters, monthly statements (print / CSV), admin console (freeze, limits, audit log).

## Tests
```bash
npm run typecheck
npm test        # starts its own server on port 8099 with a fresh database
```
See [TESTS.md](TESTS.md) for the cases and a sample history, and [DESIGN.md](DESIGN.md) for the UI design breakdown. The original console version is kept in `legacy/cli/`.

## Layout
```
server/   bank.nim (routes) · repo.nim (all SQL calls) · auth.nim · db/{schema,triggers,views}.sql
web/      src/*.ts (UI) · public/{index.html,styles.css}   -> built to public/app.js
tests/    api.test.ts
legacy/   the first console prototype
```

## Limits (by design)
Coursework demo: no HTTPS, e-mail/OTP or real payments. Login throttling is in memory and resets when the server restarts.
