## Every SQL statement the API runs lives here. Values are always bound with `?`.
import std/[json, strutils, random, os, times]
import db_connector/db_sqlite
import db_connector/sqlite3 as sq
import auth

const
  OpeningBalance* = 500_000        # centavos: the PHP 5,000 starting balance from the brief
  MaxAmount* = 100_000_000         # PHP 1,000,000 per transaction
  PageSize = 20
  SchemaSql = staticRead("db/schema.sql") & staticRead("db/triggers.sql") & staticRead("db/views.sql")
  TxKinds = ["Deposit", "Withdrawal", "Transfer In", "Transfer Out"]

type
  BankError* = ref object of CatchableError
    status*: int
    code*: string
  User* = object
    id*: int
    username*, fullName*, role*: string

var db*: DbConn

proc bankErr*(status: int, code, msg: string): BankError =
  BankError(status: status, code: code, msg: msg)

proc fail(status: int, code, msg: string) {.noreturn.} =
  raise bankErr(status, code, msg)

proc ensureTrue*(ok: bool, status: int, code, msg: string) =
  if not ok: fail(status, code, msg)

# ---- amounts -------------------------------------------------------------

proc parseAmount*(s: string): int =
  ## Peso text like "500" or "250.75" -> centavos. Negative for "-x", low(int) when malformed.
  let t = s.strip()
  let neg = t.startsWith('-')
  let p = (if neg: t[1 .. ^1] else: t).split('.')
  if p.len > 2 or p[0].len == 0 or p[0].len > 9 or not p[0].allCharsInSet(Digits): return low(int)
  let frac = if p.len == 2: p[1] else: ""
  if frac.len > 2 or not frac.allCharsInSet(Digits): return low(int)
  let v = parseInt(p[0]) * 100 + (if frac.len == 0: 0 else: parseInt(frac.alignLeft(2, '0')))
  if neg: -v else: v

proc checkedAmount*(node: JsonNode): int =
  ## Validates the "amount" field of a request; returns centavos.
  let raw = case (if node.isNil: JNull else: node.kind)
    of JString: node.getStr
    of JInt: $node.getInt
    else: ""
  let c = parseAmount(raw)
  if c == low(int): fail(400, "INVALID_AMOUNT", "Enter a valid amount, like 500 or 250.75.")
  if c <= 0: fail(400, "NON_POSITIVE_AMOUNT", "Amount must be greater than zero.")
  if c > MaxAmount: fail(400, "AMOUNT_TOO_LARGE", "Amount exceeds the PHP 1,000,000 per-transaction limit.")
  c

# ---- setup ---------------------------------------------------------------

proc runScript(script: string) =
  var err: cstring
  if sq.exec(db, script.cstring, nil, nil, err) != SQLITE_OK:
    raise newException(DbError, $err)

proc audit*(userId: int, action, detail: string) =
  db.exec(sql"INSERT INTO audit_log (user_id, action, detail) VALUES (?, ?, ?)",
          (if userId == 0: "" else: $userId), action, detail)

proc newAccountNumber(): string =
  while true:
    let n = $rand(1000..9999) & "-" & $rand(100000..999999)
    if db.getValue(sql"SELECT 1 FROM accounts WHERE number = ?", n) == "": return n

proc openAccountFor*(userId: int, kind: string, number = ""): JsonNode =
  ## `number` is only passed by the demo seed so demo accounts are the same on every machine.
  ensureTrue(kind in ["Savings", "Checking"], 400, "INVALID_KIND", "Account type must be Savings or Checking.")
  let accId = db.insertID(sql"INSERT INTO accounts (user_id, number, kind) VALUES (?, ?, ?)",
                          userId, (if number == "": newAccountNumber() else: number), kind)
  db.exec(sql"INSERT INTO transactions (account_id, kind, amount, note) VALUES (?, 'Deposit', ?, 'Opening deposit')",
          accId, OpeningBalance)
  audit(userId, "AccountOpened", "account " & $accId)
  %*{"id": accId}

proc createUser*(username, fullName, password, role: string, accountNumber = ""): int =
  let salt = newToken(16)
  try:
    result = db.insertID(sql"INSERT INTO users (username, full_name, role, salt, pw_hash) VALUES (?, ?, ?, ?, ?)",
                         username, fullName, role, salt, hashPassword(password, salt)).int
  except DbError:
    fail(409, "USERNAME_TAKEN", "That username is already taken.")
  if role == "customer": discard openAccountFor(result, "Savings", accountNumber)

proc initDb*() =
  randomize()
  db = open(getEnv("BANK_DB", getAppDir().parentDir / "bank.db"), "", "", "")
  db.exec(sql"PRAGMA foreign_keys = ON")
  runScript(SchemaSql)
  if db.getValue(sql"SELECT COUNT(*) FROM users") == "0": # demo data; credentials are in README
    discard createUser("admin", "Bank Administrator", "Admin#2026", "admin")
    discard createUser("juan", "Juan Dela Cruz", "Juan#2026", "customer", "1000-000001")
    discard createUser("maria", "Maria Santos", "Maria#2026", "customer", "1000-000002")

# ---- users & sessions ----------------------------------------------------

proc validateRegistration*(username, fullName, password: string) =
  ensureTrue(username.len in 3 .. 32 and username.allCharsInSet(IdentChars), 400, "INVALID_USERNAME",
             "Username must be 3-32 letters, numbers or underscores.")
  ensureTrue(fullName.strip().len in 1 .. 80, 400, "INVALID_NAME", "Enter your full name (max 80 characters).")
  let problem = passwordProblem(password)
  ensureTrue(problem == "", 400, "WEAK_PASSWORD", problem)

proc login*(username, password: string): (User, string) =
  let wait = lockedSeconds(username)
  ensureTrue(wait == 0, 429, "LOCKED", "Too many failed attempts. Try again in " & $wait & " seconds.")
  let r = db.getRow(sql"SELECT id, username, full_name, role, salt, pw_hash FROM users WHERE username = ?", username)
  # Hash even for unknown users so response time doesn't reveal which usernames exist.
  let known = r[0] != ""
  if not verifyPassword(password, (if known: r[4] else: "x"), (if known: r[5] else: "x")) or not known:
    recordFailure(username)
    audit(0, "LoginFailed", username)
    fail(401, "BAD_CREDENTIALS", "Incorrect username or password.")
  clearFailures(username)
  let user = User(id: parseInt(r[0]), username: r[1], fullName: r[2], role: r[3])
  let token = newToken()
  db.exec(sql"INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', 'localtime', '+7 days'))",
          token, user.id)
  audit(user.id, "Login", "")
  (user, token)

proc userForToken*(token: string): User =
  if token == "": return
  let r = db.getRow(sql"""SELECT u.id, u.username, u.full_name, u.role FROM sessions s
                          JOIN users u ON u.id = s.user_id
                          WHERE s.token = ? AND s.expires_at > datetime('now', 'localtime')""", token)
  if r[0] != "": User(id: parseInt(r[0]), username: r[1], fullName: r[2], role: r[3]) else: User()

proc endSession*(token: string) = db.exec(sql"DELETE FROM sessions WHERE token = ?", token)

proc userJson*(u: User): JsonNode =
  %*{"id": u.id, "username": u.username, "fullName": u.fullName, "role": u.role}

# ---- accounts ------------------------------------------------------------

proc accountJson(r: Row): JsonNode =
  %*{"id": parseInt(r[0]), "number": r[1], "kind": r[2], "balance": parseInt(r[3]),
     "status": r[4], "dailyLimit": parseInt(r[5]), "createdAt": r[6], "owner": r[7]}

const AccountCols = "a.id, a.number, a.kind, a.balance, a.status, a.daily_limit, a.created_at, u.full_name"

proc ownedAccount*(user: User, accountId: int): JsonNode =
  ## 404 (not 403) when it isn't yours, so ids can't be probed.
  let r = db.getRow(sql("SELECT " & AccountCols & " FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.id = ? AND a.user_id = ?"),
                    accountId, user.id)
  ensureTrue(r[0] != "", 404, "NOT_FOUND", "Account not found.")
  accountJson(r)

proc listAccounts*(user: User): JsonNode =
  result = newJArray()
  for r in db.fastRows(sql("SELECT " & AccountCols & " FROM accounts a JOIN users u ON u.id = a.user_id WHERE a.user_id = ? ORDER BY a.id"), user.id):
    result.add accountJson(r)

# ---- money movement ------------------------------------------------------

proc friendly(e: ref DbError): BankError =
  let m = e.msg
  if "INSUFFICIENT_FUNDS" in m: bankErr(409, "INSUFFICIENT_FUNDS", "Insufficient funds for this transaction.")
  elif "ACCOUNT_FROZEN" in m: bankErr(403, "ACCOUNT_FROZEN", "This account is frozen. Contact the bank.")
  elif "DAILY_LIMIT" in m: bankErr(409, "DAILY_LIMIT", "This would exceed the account's daily withdrawal limit.")
  else: bankErr(500, "DB_ERROR", "Something went wrong. Please try again.")

proc post(accountId: int, kind: string, amount: int, counterparty, note: string) =
  db.exec(sql"INSERT INTO transactions (account_id, kind, amount, counterparty, note) VALUES (?, ?, ?, NULLIF(?, ''), NULLIF(?, ''))",
          accountId, kind, amount, counterparty, note)

proc deposit*(user: User, accountId, amount: int, note: string): JsonNode =
  discard ownedAccount(user, accountId)
  try: post(accountId, "Deposit", amount, "", note)
  except DbError as e: raise friendly(e)
  ownedAccount(user, accountId)

proc withdraw*(user: User, accountId, amount: int, note: string): JsonNode =
  discard ownedAccount(user, accountId)
  try: post(accountId, "Withdrawal", amount, "", note)
  except DbError as e: raise friendly(e)
  ownedAccount(user, accountId)

proc normalizeAccountNumber*(s: string): string =
  var digits = ""
  for c in s:
    if c in {'0'..'9'}: digits.add(c)
  if digits.len == 10:
    return digits[0..3] & "-" & digits[4..9]
  return s.strip()

proc maskName*(name: string): string =
  var parts: seq[string] = @[]
  for word in name.splitWhitespace():
    if word.len > 0:
      parts.add word[0].toUpperAscii() & "***"
  parts.join(" ")

proc lookupAccount*(user: User, rawNumber: string): JsonNode =
  let norm = normalizeAccountNumber(rawNumber)
  let plain = rawNumber.strip().replace("-", "")
  ensureTrue(plain != "", 400, "INVALID_NUMBER", "Enter an account number.")
  let r = db.getRow(sql"""
    SELECT a.id, a.number, u.full_name, a.kind, a.status, a.user_id
    FROM accounts a
    JOIN users u ON u.id = a.user_id
    WHERE a.number = ? OR REPLACE(a.number, '-', '') = ?
  """, norm, plain)
  ensureTrue(r[0] != "", 404, "DEST_NOT_FOUND", "Destination account number not found.")
  %*{"id": parseInt(r[0]), "number": r[1], "name": maskName(r[2]), "kind": r[3], "status": r[4], "isSelf": (parseInt(r[5]) == user.id)}

proc transfer*(user: User, fromId: int, toNumber: string, amount: int, note: string): JsonNode =
  let src = ownedAccount(user, fromId)
  let norm = normalizeAccountNumber(toNumber)
  let plain = toNumber.strip().replace("-", "")
  let dest = db.getRow(sql"""
    SELECT id, number FROM accounts
    WHERE number = ? OR REPLACE(number, '-', '') = ?
  """, norm, plain)
  ensureTrue(dest[0] != "", 404, "DEST_NOT_FOUND", "Destination account number not found.")
  ensureTrue(dest[0] != $fromId, 400, "SAME_ACCOUNT", "Choose a different destination account.")
  db.exec(sql"BEGIN IMMEDIATE") # both legs succeed or neither does
  try:
    post(fromId, "Transfer Out", amount, dest[1], note)
    post(parseInt(dest[0]), "Transfer In", amount, src["number"].getStr, note)
    db.exec(sql"COMMIT")
  except DbError as e:
    db.exec(sql"ROLLBACK")
    raise friendly(e)
  ownedAccount(user, fromId)

# ---- history & statements ------------------------------------------------

proc txJson(r: Row): JsonNode =
  %*{"id": parseInt(r[0]), "kind": r[1], "amount": parseInt(r[2]), "balanceAfter": parseInt(r[3]),
     "counterparty": r[4], "note": r[5], "createdAt": r[6]}

proc validDate(s: string): bool =
  if s == "": return true
  try: discard parse(s, "yyyy-MM-dd"); true
  except TimeParseError: false

proc likePattern(q: string): string =
  ## "%term%" with LIKE wildcards in the term escaped, so "50%" searches for a literal 50%.
  "%" & q.multiReplace(("\\", "\\\\"), ("%", "\\%"), ("_", "\\_")) & "%"

proc amountKey(q: string): int =
  ## Centavos when the search text is an amount like "1500" or "250.75", else -1 (never matches).
  let c = parseAmount(q)
  if c == low(int) or c <= 0: -1 else: c

proc checkedQuery(q: string): string =
  result = q.strip()
  ensureTrue(result.len <= 60, 400, "INVALID_QUERY", "Search text is too long (max 60 characters).")

proc history*(user: User, accountId: int, kind, dateFrom, dateTo, search: string, page: int): JsonNode =
  discard ownedAccount(user, accountId)
  ensureTrue(kind == "" or kind in TxKinds, 400, "INVALID_FILTER", "Unknown transaction type.")
  ensureTrue(validDate(dateFrom) and validDate(dateTo), 400, "INVALID_FILTER", "Dates must look like 2026-10-31.")
  let p = max(page, 1)
  let q = checkedQuery(search)
  let pat = likePattern(q)
  let amt = amountKey(q)
  const Where = " FROM transactions WHERE account_id = ? AND (? = '' OR kind = ?) AND (? = '' OR date(created_at) >= ?) AND (? = '' OR date(created_at) <= ?)" &
    " AND (? = '' OR note LIKE ? ESCAPE '\\' OR counterparty LIKE ? ESCAPE '\\' OR kind LIKE ? ESCAPE '\\' OR amount = ?)"
  let total = parseInt db.getValue(sql("SELECT COUNT(*)" & Where), accountId, kind, kind, dateFrom, dateFrom, dateTo, dateTo, q, pat, pat, pat, amt)
  var items = newJArray()
  for r in db.fastRows(sql("SELECT id, kind, amount, balance_after, COALESCE(counterparty, ''), COALESCE(note, ''), created_at" & Where &
                           " ORDER BY id DESC LIMIT ? OFFSET ?"),
                       accountId, kind, kind, dateFrom, dateFrom, dateTo, dateTo, q, pat, pat, pat, amt, PageSize, (p - 1) * PageSize):
    items.add txJson(r)
  %*{"items": items, "total": total, "page": p, "pageSize": PageSize}

proc searchAll*(user: User, search: string): JsonNode =
  ## Across all of the user's accounts: note, counterparty, type, account number or exact amount.
  let q = checkedQuery(search)
  ensureTrue(q.len >= 1, 400, "INVALID_QUERY", "Type something to search for.")
  let pat = likePattern(q)
  var items = newJArray()
  for r in db.fastRows(sql("""SELECT t.id, t.kind, t.amount, t.balance_after, COALESCE(t.counterparty, ''), COALESCE(t.note, ''), t.created_at, a.number, a.id
                              FROM transactions t JOIN accounts a ON a.id = t.account_id
                              WHERE a.user_id = ? AND (t.note LIKE ? ESCAPE '\' OR t.counterparty LIKE ? ESCAPE '\' OR t.kind LIKE ? ESCAPE '\'
                                                       OR a.number LIKE ? ESCAPE '\' OR t.amount = ?)
                              ORDER BY t.id DESC LIMIT 30"""),
                       user.id, pat, pat, pat, pat, amountKey(q)):
    var j = txJson(r)
    j["accountNumber"] = %r[7]
    j["accountId"] = %parseInt(r[8])
    items.add j
  %*{"items": items, "query": q}

proc statement*(user: User, accountId: int, month: string): JsonNode =
  let acct = ownedAccount(user, accountId)
  ensureTrue(month.len == 7 and validDate(month & "-01") and month[4] == '-', 400, "INVALID_MONTH", "Month must look like 2026-10.")
  var items = newJArray()
  for r in db.fastRows(sql"""SELECT id, kind, amount, balance_after, COALESCE(counterparty, ''), COALESCE(note, ''), created_at
                             FROM v_statement WHERE account_id = ? AND month = ? ORDER BY id""", accountId, month):
    items.add txJson(r)
  let s = db.getRow(sql"SELECT credits, debits, entries FROM v_month_summary WHERE account_id = ? AND month = ?", accountId, month)
  let before = db.getValue(sql"SELECT balance_after FROM transactions WHERE account_id = ? AND created_at < ? ORDER BY id DESC LIMIT 1",
                           accountId, month & "-01")
  let opening = if before == "": 0 else: parseInt(before)
  let closing = if items.len > 0: items[items.len - 1]["balanceAfter"].getInt else: opening
  %*{"account": acct, "month": month, "openingBalance": opening, "closingBalance": closing,
     "credits": (if s[0] == "": 0 else: parseInt(s[0])), "debits": (if s[1] == "": 0 else: parseInt(s[1])),
     "entries": items.len, "items": items}

# ---- admin ---------------------------------------------------------------

proc adminOverview*(): JsonNode =
  let r = db.getRow(sql"SELECT customers, accounts, total_deposits, frozen_accounts, transactions_today FROM v_admin_overview")
  %*{"customers": parseInt(r[0]), "accounts": parseInt(r[1]), "totalDeposits": parseInt(r[2]),
     "frozenAccounts": parseInt(r[3]), "transactionsToday": parseInt(r[4])}

proc adminAccounts*(): JsonNode =
  result = newJArray()
  for r in db.fastRows(sql("SELECT " & AccountCols & " FROM accounts a JOIN users u ON u.id = a.user_id ORDER BY a.id")):
    result.add accountJson(r)

proc adminUsers*(): JsonNode =
  result = newJArray()
  for r in db.fastRows(sql"""SELECT u.id, u.username, u.full_name, u.role, u.created_at,
                                    (SELECT COUNT(*) FROM accounts WHERE user_id = u.id) FROM users u ORDER BY u.id"""):
    result.add %*{"id": parseInt(r[0]), "username": r[1], "fullName": r[2], "role": r[3], "createdAt": r[4], "accounts": parseInt(r[5])}

proc setStatus*(admin: User, accountId: int, status: string) =
  db.exec(sql"UPDATE accounts SET status = ? WHERE id = ?", status, accountId)
  ensureTrue(db.getValue(sql"SELECT 1 FROM accounts WHERE id = ?", accountId) != "", 404, "NOT_FOUND", "Account not found.")
  audit(admin.id, (if status == "frozen": "AccountFrozen" else: "AccountUnfrozen"), "account " & $accountId)

proc setDailyLimit*(admin: User, accountId, limit: int) =
  ensureTrue(limit > 0 and limit <= MaxAmount * 10, 400, "INVALID_LIMIT", "Enter a valid daily limit.")
  ensureTrue(db.getValue(sql"SELECT 1 FROM accounts WHERE id = ?", accountId) != "", 404, "NOT_FOUND", "Account not found.")
  db.exec(sql"UPDATE accounts SET daily_limit = ? WHERE id = ?", limit, accountId)
  audit(admin.id, "LimitChanged", "account " & $accountId & " limit " & $limit)

proc auditLog*(): JsonNode =
  result = newJArray()
  for r in db.fastRows(sql"""SELECT l.id, COALESCE(u.username, ''), l.action, COALESCE(l.detail, ''), l.created_at
                             FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 100"""):
    result.add %*{"id": parseInt(r[0]), "user": r[1], "action": r[2], "detail": r[3], "createdAt": r[4]}
