import std/[os, strutils]
import db_connector/db_sqlite

const StartingBalance = 500_000 # centavos (PHP 5,000.00); integers avoid float rounding

var
  db: DbConn
  balance = StartingBalance

proc peso(c: int): string =
  "₱" & insertSep($(c div 100), ',') & "." & intToStr(c mod 100, 2)

proc parseAmount(s: string): int =
  ## Centavos (negative for "-x"), or low(int) when not a number like 500 or 250.75.
  let t = s.strip()
  let neg = t.startsWith('-')
  let p = (if neg: t[1 .. ^1] else: t).split('.')
  if p.len > 2 or p[0].len == 0 or not p[0].allCharsInSet(Digits): return low(int)
  let frac = if p.len == 2: p[1] else: ""
  if frac.len > 2 or not frac.allCharsInSet(Digits): return low(int)
  try:
    let v = parseInt(p[0]) * 100 + (if frac.len == 0: 0 else: parseInt(frac.alignLeft(2, '0')))
    result = if neg: -v else: v
  except ValueError: # integer overflow
    result = low(int)

proc showHistory() =
  echo "\n--- Transaction History ---"
  var any = false
  for r in db.fastRows(sql"SELECT id, type, amount_centavos, balance_after FROM transactions ORDER BY id"):
    any = true
    echo r[0], ". ", alignLeft(r[1], 10), " ", align(peso(parseInt r[2]), 12), "  Balance: ", peso(parseInt r[3])
  if not any: echo "No transactions yet."

proc transact(kind: string) =
  while true: # re-prompt until valid
    stdout.write "Enter amount to " & (if kind == "Deposit": "deposit" else: "withdraw") & " (or 'c' to cancel): "
    var line: string
    if not stdin.readLine(line): quit(0)
    if line.strip().toLowerAscii() == "c": return
    let amt = parseAmount(line)
    if amt == low(int): echo "Error: invalid input. Enter a number like 500 or 250.75."
    elif amt <= 0: echo "Error: amount must be greater than zero."
    elif kind == "Withdrawal" and amt > balance:
      echo "Error: insufficient funds. Available balance: ", peso(balance)
    else:
      balance += (if kind == "Deposit": amt else: -amt)
      db.exec(sql"INSERT INTO transactions (type, amount_centavos, balance_after) VALUES (?, ?, ?)",
              kind, amt, balance)
      echo kind, " successful. New balance: ", peso(balance)
      return

proc main() =
  when defined(windows): discard execShellCmd("chcp 65001 > nul") # show ₱
  db = open("bank.db", "", "", "")
  const schema = staticRead("schema.sql") # embedded at compile time
  db.exec(sql(schema))
  db.exec(sql"DELETE FROM transactions") # each run starts a fresh account
  echo "Account opened. Current balance: ", peso(balance)
  while true:
    echo "\n=== Banking Menu ===\n1. Check Balance\n2. Deposit Money\n3. Withdraw Money\n4. View Transaction History\n5. Exit"
    stdout.write "Choose (1-5): "
    var choice: string
    if not stdin.readLine(choice): break
    case choice.strip()
    of "1": echo "Current balance: ", peso(balance)
    of "2": transact "Deposit"
    of "3": transact "Withdrawal"
    of "4": showHistory()
    of "5": echo "Thank you for banking with us."; break
    else: echo "Error: invalid menu selection. Please enter 1-5."
  db.close()

main()
