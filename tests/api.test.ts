// Run: node --test tests/     (build first: bash build.sh)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";

const PORT = 8099;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = "tests/test.db";
let server: ChildProcess;

before(async () => {
  rmSync(DB, { force: true });
  server = spawn("./server/bank.exe", [], { env: { ...process.env, PORT: String(PORT), BANK_DB: DB }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/me`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("server did not start");
});
after(() => { server.kill(); });

/** Minimal client with a cookie jar (Node's fetch doesn't keep cookies). */
class Client {
  cookie = "";
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* csv/html */ }
    return { status: res.status, json, text };
  }
  get = (p: string) => this.call("GET", p);
  post = (p: string, b?: unknown) => this.call("POST", p, b);
}

let n = 0;
async function customer() {
  const c = new Client();
  const username = `user_${Date.now()}_${n++}`;
  const r = await c.post("/api/register", { username, fullName: "Test User", password: "Passw0rd!" });
  assert.equal(r.status, 201);
  const { json } = await c.get("/api/accounts");
  return { c, username, acct: json.accounts[0] as { id: number; number: string; balance: number } };
}
async function admin() {
  const c = new Client();
  assert.equal((await c.post("/api/login", { username: "admin", password: "Admin#2026" })).status, 200);
  return c;
}
const balance = async (c: Client, id: number) => (await c.get(`/api/accounts/${id}`)).json.account.balance as number;

test("1. new account starts at ₱5,000.00", async () => {
  const { acct } = await customer();
  assert.equal(acct.balance, 500_000);
});

test("2. valid deposit increases balance and is recorded", async () => {
  const { c, acct } = await customer();
  const r = await c.post(`/api/accounts/${acct.id}/deposit`, { amount: "1500" });
  assert.equal(r.status, 200);
  assert.equal(r.json.account.balance, 650_000);
  const h = await c.get(`/api/accounts/${acct.id}/transactions`);
  assert.equal(h.json.items[0].kind, "Deposit");
  assert.equal(h.json.items[0].amount, 150_000);
  assert.equal(h.json.items[0].balanceAfter, 650_000);
});

test("3. valid withdrawal decreases balance, decimals allowed", async () => {
  const { c, acct } = await customer();
  const r = await c.post(`/api/accounts/${acct.id}/withdraw`, { amount: "2000.50" });
  assert.equal(r.status, 200);
  assert.equal(r.json.account.balance, 500_000 - 200_050);
});

test("4. overdraft is rejected and the balance is unchanged", async () => {
  const { c, acct } = await customer();
  const r = await c.post(`/api/accounts/${acct.id}/withdraw`, { amount: "5000.01" });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "INSUFFICIENT_FUNDS");
  assert.equal(await balance(c, acct.id), 500_000);
  assert.equal((await c.get(`/api/accounts/${acct.id}/transactions`)).json.total, 1); // only the opening deposit
});

test("5. zero, negative, non-numeric and malformed amounts are rejected", async () => {
  const { c, acct } = await customer();
  for (const [amount, code] of [["0", "NON_POSITIVE_AMOUNT"], ["-50", "NON_POSITIVE_AMOUNT"], ["abc", "INVALID_AMOUNT"],
    ["12.345", "INVALID_AMOUNT"], ["", "INVALID_AMOUNT"], [null, "INVALID_AMOUNT"], ["1e5", "INVALID_AMOUNT"], ["2000000", "AMOUNT_TOO_LARGE"]] as const) {
    for (const kind of ["deposit", "withdraw"]) {
      const r = await c.post(`/api/accounts/${acct.id}/${kind}`, { amount });
      assert.equal(r.status, 400, `${kind} ${amount}`);
      assert.equal(r.json.code, code, `${kind} ${amount}`);
    }
  }
  assert.equal(await balance(c, acct.id), 500_000);
});

test("6. unknown endpoint and unauthenticated access", async () => {
  const anon = new Client();
  assert.equal((await anon.get("/api/accounts")).status, 401);
  assert.equal((await anon.post("/api/accounts/1/deposit", { amount: "1" })).status, 401);
  assert.equal((await anon.get("/api/nope")).status, 404);
});

test("7. wrong password is refused, and 5 failures lock the user", async () => {
  const { username } = await customer();
  const c = new Client();
  for (let i = 0; i < 5; i++) assert.equal((await c.post("/api/login", { username, password: "wrong" })).status, 401);
  const locked = await c.post("/api/login", { username, password: "Passw0rd!" });
  assert.equal(locked.status, 429);
});

test("8. registration validation: weak password, bad username, duplicate", async () => {
  const c = new Client();
  assert.equal((await c.post("/api/register", { username: "okname", fullName: "A", password: "short" })).json.code, "WEAK_PASSWORD");
  assert.equal((await c.post("/api/register", { username: "no spaces", fullName: "A", password: "Passw0rd!" })).json.code, "INVALID_USERNAME");
  const { username } = await customer();
  assert.equal((await c.post("/api/register", { username, fullName: "A", password: "Passw0rd!" })).status, 409);
});

test("9. transfer moves money between accounts and is recorded on both", async () => {
  const a = await customer(), b = await customer();
  const r = await a.c.post("/api/transfers", { fromAccountId: a.acct.id, toNumber: b.acct.number, amount: "1000", note: "rent" });
  assert.equal(r.status, 200);
  assert.equal(await balance(a.c, a.acct.id), 400_000);
  assert.equal(await balance(b.c, b.acct.id), 600_000);
  assert.equal((await a.c.get(`/api/accounts/${a.acct.id}/transactions`)).json.items[0].kind, "Transfer Out");
  assert.equal((await b.c.get(`/api/accounts/${b.acct.id}/transactions`)).json.items[0].kind, "Transfer In");

  // Account lookup with formatted and unformatted number
  const lookup1 = await a.c.get(`/api/accounts/lookup?number=${b.acct.number}`);
  assert.equal(lookup1.status, 200);
  assert.equal(lookup1.json.account.number, b.acct.number);
  assert.equal(lookup1.json.account.name, "T*** U***");

  const unformatted = b.acct.number.replace("-", "");
  const lookup2 = await a.c.get(`/api/accounts/lookup?number=${unformatted}`);
  assert.equal(lookup2.status, 200);
  assert.equal(lookup2.json.account.number, b.acct.number);

  // Transfer with unformatted number succeeds
  const rUnformatted = await a.c.post("/api/transfers", { fromAccountId: a.acct.id, toNumber: unformatted, amount: "50" });
  assert.equal(rUnformatted.status, 200);
});

test("10. a failed transfer changes neither account (atomic)", async () => {
  const a = await customer(), b = await customer();
  const r = await a.c.post("/api/transfers", { fromAccountId: a.acct.id, toNumber: b.acct.number, amount: "9000" });
  assert.equal(r.status, 409);
  assert.equal(await balance(a.c, a.acct.id), 500_000);
  assert.equal(await balance(b.c, b.acct.id), 500_000);
  assert.equal((await a.c.post("/api/transfers", { fromAccountId: a.acct.id, toNumber: a.acct.number, amount: "1" })).json.code, "SAME_ACCOUNT");
  assert.equal((await a.c.post("/api/transfers", { fromAccountId: a.acct.id, toNumber: "0000-000000", amount: "1" })).json.code, "DEST_NOT_FOUND");
});

test("11. a customer cannot see or use someone else's account", async () => {
  const a = await customer(), b = await customer();
  assert.equal((await b.c.get(`/api/accounts/${a.acct.id}`)).status, 404);
  assert.equal((await b.c.post(`/api/accounts/${a.acct.id}/withdraw`, { amount: "1" })).status, 404);
  assert.equal((await b.c.get(`/api/accounts/${a.acct.id}/transactions`)).status, 404);
  assert.equal((await b.c.post("/api/transfers", { fromAccountId: a.acct.id, toNumber: b.acct.number, amount: "1" })).status, 404);
});

test("12. frozen account can receive but not send; unfreezing restores it", async () => {
  const a = await customer(), b = await customer();
  const ad = await admin();
  assert.equal((await ad.post(`/api/admin/accounts/${a.acct.id}/freeze`)).status, 200);
  assert.equal((await a.c.post(`/api/accounts/${a.acct.id}/withdraw`, { amount: "1" })).json.code, "ACCOUNT_FROZEN");
  assert.equal((await a.c.post("/api/transfers", { fromAccountId: a.acct.id, toNumber: b.acct.number, amount: "1" })).json.code, "ACCOUNT_FROZEN");
  assert.equal((await b.c.post("/api/transfers", { fromAccountId: b.acct.id, toNumber: a.acct.number, amount: "10" })).status, 200);
  assert.equal((await ad.post(`/api/admin/accounts/${a.acct.id}/unfreeze`)).status, 200);
  assert.equal((await a.c.post(`/api/accounts/${a.acct.id}/withdraw`, { amount: "1" })).status, 200);
});

test("13. daily withdrawal limit is enforced by the database", async () => {
  const a = await customer();
  const ad = await admin();
  assert.equal((await ad.post(`/api/admin/accounts/${a.acct.id}/limit`, { limit: "1000" })).status, 200);
  assert.equal((await a.c.post(`/api/accounts/${a.acct.id}/withdraw`, { amount: "600" })).status, 200);
  const r = await a.c.post(`/api/accounts/${a.acct.id}/withdraw`, { amount: "600" });
  assert.equal(r.json.code, "DAILY_LIMIT");
});

test("14. admin endpoints are admin-only and the audit log records actions", async () => {
  const { c, acct } = await customer();
  for (const p of ["/api/admin/overview", "/api/admin/users", "/api/admin/accounts", "/api/admin/audit"]) assert.equal((await c.get(p)).status, 403, p);
  assert.equal((await c.post(`/api/admin/accounts/${acct.id}/freeze`)).status, 403);
  const ad = await admin();
  await c.post(`/api/accounts/${acct.id}/deposit`, { amount: "5" });
  const audit = (await ad.get("/api/admin/audit")).json.entries as { action: string }[];
  assert.ok(audit.some((e) => e.action === "Deposit") && audit.some((e) => e.action === "Login"));
  assert.ok((await ad.get("/api/admin/overview")).json.totalDeposits > 0);
});

test("15. JSON is required for writes and malformed JSON is a 400", async () => {
  const { c, acct } = await customer();
  assert.equal((await c.call("POST", `/api/accounts/${acct.id}/deposit`, '{"amount":"1"}', { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await c.call("POST", `/api/accounts/${acct.id}/deposit`, "{oops", { "Content-Type": "application/json" })).status, 400);
});

test("16. statement CSV and filtered history", async () => {
  const { c, acct } = await customer();
  await c.post(`/api/accounts/${acct.id}/deposit`, { amount: "100" });
  await c.post(`/api/accounts/${acct.id}/withdraw`, { amount: "40" });
  const month = new Date().toLocaleDateString("sv-SE").slice(0, 7);
  const csv = await c.get(`/api/accounts/${acct.id}/statement?month=${month}&format=csv`);
  assert.match(csv.text, /Deposit,100\.00,5100\.00/);
  assert.match(csv.text, /Withdrawal,40\.00,5060\.00/);
  const only = await c.get(`/api/accounts/${acct.id}/transactions?type=Withdrawal`);
  assert.equal(only.json.total, 1);
  assert.equal((await c.get(`/api/accounts/${acct.id}/transactions?type=Bogus`)).status, 400);
  assert.equal((await c.get(`/api/accounts/${acct.id}/statement?month=2026-13`)).status, 400);
});

test("18. history search matches note, amount and type; wildcards are literal", async () => {
  const { c, acct } = await customer();
  await c.post(`/api/accounts/${acct.id}/deposit`, { amount: "1500", note: "Rent share" });
  await c.post(`/api/accounts/${acct.id}/withdraw`, { amount: "40", note: "coffee 100%" });
  const find = async (q: string) => (await c.get(`/api/accounts/${acct.id}/transactions?q=${encodeURIComponent(q)}`)).json.total as number;
  assert.equal(await find("rent"), 1);            // case-insensitive note match
  assert.equal(await find("1500"), 1);            // exact amount
  assert.equal(await find("40.00"), 1);
  assert.equal(await find("withdrawal"), 1);      // type
  assert.equal(await find("nothing-like-this"), 0);
  assert.equal(await find("100%"), 1);            // % is a literal character...
  assert.equal(await find("%"), 1);               // ...not "match everything"
  assert.equal(await find("_"), 0);               // same for _
  assert.equal((await c.get(`/api/accounts/${acct.id}/transactions?q=${"x".repeat(61)}`)).status, 400);
});

test("19. global search covers all my accounts, nobody else's", async () => {
  const a = await customer(), b = await customer();
  await a.c.post("/api/accounts", { kind: "Checking" });
  const accts = (await a.c.get("/api/accounts")).json.accounts as { id: number; number: string }[];
  await a.c.post(`/api/accounts/${accts[1].id}/deposit`, { amount: "123.45", note: "salary-bonus" });
  const hit = await a.c.get("/api/search?q=salary");
  assert.equal(hit.status, 200);
  assert.equal(hit.json.items.length, 1);
  assert.equal(hit.json.items[0].accountNumber, accts[1].number);
  assert.equal((await a.c.get("/api/search?q=123.45")).json.items.length, 1);
  assert.ok((await a.c.get("/api/search?q=opening")).json.items.length >= 2); // opening deposits of both accounts
  assert.equal((await b.c.get("/api/search?q=salary")).json.items.length, 0);  // not visible to another customer
  assert.equal((await new Client().get("/api/search?q=x")).status, 401);
  assert.equal((await a.c.get("/api/search?q=")).status, 400);
});

test("20. demo accounts have fixed numbers on every fresh database", async () => {
  const numberOf = async (username: string, password: string) => {
    const c = new Client();
    assert.equal((await c.post("/api/login", { username, password })).status, 200);
    return (await c.get("/api/accounts")).json.accounts[0].number as string;
  };
  assert.equal(await numberOf("juan", "Juan#2026"), "1000-000001");
  assert.equal(await numberOf("maria", "Maria#2026"), "1000-000002");
});

test("17. logout ends the session", async () => {
  const { c } = await customer();
  assert.equal((await c.get("/api/me")).status, 200);
  const old = c.cookie;
  await c.post("/api/logout");
  c.cookie = old; // replay the old token: the server-side session must be gone, not just the cookie
  assert.equal((await c.get("/api/me")).status, 401);
});
