import std/[json, strutils, os, xmltree]
import jester
import repo

type Reply = tuple[code: HttpCode, body: string]

# Found relative to server/bank.exe, so it works no matter which folder you start it from.
proc publicDir(): string = getAppDir().parentDir / "web" / "public"
echo "Serving UI from ", publicDir()

proc ok(j: JsonNode, code = Http200): Reply = (code, $j)

proc errReply(e: BankError): Reply =
  (HttpCode(e.status), $(%*{"error": e.msg, "code": e.code}))

proc jsonBody(req: Request): JsonNode =
  ## JSON-only POST bodies: a cross-site HTML form can't send this content type without a CORS preflight.
  if "application/json" notin req.headers.getOrDefault("Content-Type"):
    raise bankErr(415, "JSON_REQUIRED", "Send a JSON body.")
  try: result = parseJson(req.body)
  except JsonParsingError: raise bankErr(400, "INVALID_JSON", "Malformed JSON.")
  if result.kind != JObject: raise bankErr(400, "INVALID_JSON", "Expected a JSON object.")

proc field(j: JsonNode, key: string): string =
  if j.hasKey(key) and j[key].kind == JString: j[key].getStr else: ""

proc idOf(s: string): int =
  try: parseInt(s) except ValueError: raise bankErr(404, "NOT_FOUND", "Not found.")

proc session(req: Request): User =
  result = userForToken(req.cookies.getOrDefault("sid"))
  if result.id == 0: raise bankErr(401, "UNAUTHENTICATED", "Please sign in.")

proc admin(req: Request): User =
  result = session(req)
  if result.role != "admin": raise bankErr(403, "FORBIDDEN", "Administrators only.")

proc csvOf(st: JsonNode): string =
  result = "Date,Type,Amount (PHP),Balance (PHP),Counterparty,Note\n"
  for t in st["items"]:
    let pesos = proc(c: int): string = $(c div 100) & "." & intToStr(c mod 100, 2)
    result.add [t["createdAt"].getStr, t["kind"].getStr, pesos(t["amount"].getInt), pesos(t["balanceAfter"].getInt),
                t["counterparty"].getStr, "\"" & t["note"].getStr.replace("\"", "\"\"") & "\""].join(",") & "\n"

proc htmlOf(st: JsonNode): string =
  let pesos = proc(c: int): string = "PHP " & $(c div 100) & "." & intToStr(c mod 100, 2)
  var rows = ""
  for t in st["items"]:
    rows.add "<tr><td>" & xmltree.escape(t["createdAt"].getStr) & "</td><td>" & xmltree.escape(t["kind"].getStr) & "</td><td class=n>" &
             pesos(t["amount"].getInt) & "</td><td class=n>" & pesos(t["balanceAfter"].getInt) & "</td></tr>"
  let a = st["account"]
  """<!doctype html><meta charset=utf-8><title>Statement</title>
<style>body{font:15px system-ui;max-width:760px;margin:2rem auto;padding:0 1rem}table{width:100%;border-collapse:collapse}
th,td{padding:.4rem;border-bottom:1px solid #ccc;text-align:left}.n{text-align:right}</style>
<h1>Account statement</h1><p>""" & xmltree.escape(a["owner"].getStr) & " &middot; " & xmltree.escape(a["number"].getStr) & " &middot; " &
  xmltree.escape(st["month"].getStr) & "</p><p>Opening " & pesos(st["openingBalance"].getInt) & " &middot; Credits " &
  pesos(st["credits"].getInt) & " &middot; Debits " & pesos(st["debits"].getInt) & " &middot; Closing " &
  pesos(st["closingBalance"].getInt) & "</p><table><tr><th>Date<th>Type<th class=n>Amount<th class=n>Balance</tr>" &
  rows & "</table><p><button onclick=print()>Print</button></p>"

template reply(r: Reply) = resp r.code, r.body, "application/json"

template guarded(work: untyped) =
  ## Runs a handler; any BankError becomes a JSON error response.
  try:
    let r: Reply = work
    reply r
  except BankError as e:
    reply errReply(e)

initDb()

settings:
  port = Port(parseInt(getEnv("PORT", "8080")))
  bindAddr = getEnv("BIND", "127.0.0.1") # localhost only unless you opt in
  staticDir = publicDir() # absolute: Jester's path check breaks on mixed separators

routes:
  get "/":
    sendFile publicDir() / "index.html"

  # ---- auth
  post "/api/register":
    try:
      let j = request.jsonBody()
      validateRegistration(j.field("username"), j.field("fullName"), j.field("password"))
      discard createUser(j.field("username"), j.field("fullName").strip(), j.field("password"), "customer")
      let (user, token) = login(j.field("username"), j.field("password"))
      setCookie("sid", token, daysForward(7), sameSite = Strict, httpOnly = true, path = "/")
      reply ok(%*{"user": userJson(user)}, Http201)
    except BankError as e: reply errReply(e)

  post "/api/login":
    try:
      let j = request.jsonBody()
      let (user, token) = login(j.field("username"), j.field("password"))
      setCookie("sid", token, daysForward(7), sameSite = Strict, httpOnly = true, path = "/")
      reply ok(%*{"user": userJson(user)})
    except BankError as e: reply errReply(e)

  post "/api/logout":
    endSession(request.cookies.getOrDefault("sid"))
    setCookie("sid", "", daysForward(-1), sameSite = Strict, httpOnly = true, path = "/")
    reply ok(%*{"ok": true})

  get "/api/me":
    guarded ok(%*{"user": userJson(session(request))})

  # ---- accounts
  get "/api/accounts":
    guarded ok(%*{"accounts": listAccounts(session(request))})

  post "/api/accounts":
    guarded (block:
      let u = session(request)
      discard openAccountFor(u.id, request.jsonBody().field("kind"))
      ok(%*{"accounts": listAccounts(u)}, Http201))

  get "/api/accounts/@id":
    guarded ok(%*{"account": ownedAccount(session(request), idOf(@"id"))})

  post "/api/accounts/@id/deposit":
    guarded (block:
      let u = session(request)
      let j = request.jsonBody()
      ok(%*{"account": deposit(u, idOf(@"id"), checkedAmount(j.getOrDefault("amount")), j.field("note"))}))

  post "/api/accounts/@id/withdraw":
    guarded (block:
      let u = session(request)
      let j = request.jsonBody()
      ok(%*{"account": withdraw(u, idOf(@"id"), checkedAmount(j.getOrDefault("amount")), j.field("note"))}))

  post "/api/transfers":
    guarded (block:
      let u = session(request)
      let j = request.jsonBody()
      let fromId = if j.hasKey("fromAccountId") and j["fromAccountId"].kind == JInt: j["fromAccountId"].getInt else: 0
      ok(%*{"account": transfer(u, fromId, j.field("toNumber"), checkedAmount(j.getOrDefault("amount")), j.field("note"))}))

  get "/api/accounts/@id/transactions":
    guarded (block:
      let u = session(request)
      let q = request.params
      var page = 1
      try: page = parseInt(q.getOrDefault("page", "1"))
      except ValueError: discard
      ok(history(u, idOf(@"id"), q.getOrDefault("type"), q.getOrDefault("from"), q.getOrDefault("to"), q.getOrDefault("q"), page)))

  get "/api/search":
    guarded ok(searchAll(session(request), request.params.getOrDefault("q")))

  get "/api/accounts/@id/statement":
    try:
      let u = session(request)
      let st = statement(u, idOf(@"id"), request.params.getOrDefault("month"))
      case request.params.getOrDefault("format", "json")
      of "csv": resp Http200, csvOf(st), "text/csv"
      of "html": resp Http200, htmlOf(st), "text/html;charset=utf-8"
      else: reply ok(st)
    except BankError as e: reply errReply(e)

  # ---- admin
  get "/api/admin/overview":
    guarded (block: discard admin(request); ok(adminOverview()))

  get "/api/admin/users":
    guarded (block: discard admin(request); ok(%*{"users": adminUsers()}))

  get "/api/admin/accounts":
    guarded (block: discard admin(request); ok(%*{"accounts": adminAccounts()}))

  post "/api/admin/accounts/@id/freeze":
    guarded (block: setStatus(admin(request), idOf(@"id"), "frozen"); ok(%*{"ok": true}))

  post "/api/admin/accounts/@id/unfreeze":
    guarded (block: setStatus(admin(request), idOf(@"id"), "active"); ok(%*{"ok": true}))

  post "/api/admin/accounts/@id/limit":
    guarded (block:
      let a = admin(request)
      setDailyLimit(a, idOf(@"id"), checkedAmount(request.jsonBody().getOrDefault("limit")))
      ok(%*{"ok": true}))

  get "/api/admin/audit":
    guarded (block: discard admin(request); ok(%*{"entries": auditLog()}))

  get "/api/@rest":
    resp Http404, $(%*{"error": "Unknown endpoint.", "code": "NOT_FOUND"}), "application/json"

