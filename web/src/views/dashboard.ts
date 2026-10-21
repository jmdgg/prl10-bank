import { api, ApiError, Account, HistoryPage, SearchHit, Tx, User } from "../api";
import { h, btn, linkBtn, emptyState, peso, toast, copyText } from "../util";
import { icon, IconName } from "../icons";
import { moneyDialog } from "./dialogs";
import { txRow } from "./tx";

/** Full account card with Deposit / Withdraw (used on the account page). */
export function accountCard(a: Account, refresh: () => void): HTMLElement {
  const frozen = a.status === "frozen";
  return h("article", { class: `card account${frozen ? " is-frozen" : ""}`, "aria-label": `${a.kind} account ${a.number}` },
    h("div", { class: "row between center" },
      h("span", { class: "tag" }, a.kind),
      frozen && h("span", { class: "tag danger" }, icon("lock", 14), "Frozen")),
    h("div", { class: "acct-no" }, h("span", null, a.number),
      btn("text", "Copy", { small: true, icon: "copy", label: `Copy account number ${a.number}`, onclick: () => copyText(a.number, "Account number") })),
    h("p", { class: "muted label" }, "Available balance"),
    h("p", { class: "balance" }, peso(a.balance)),
    frozen && h("p", { class: "notice danger", role: "note" }, icon("lock", 18),
      h("span", null, "This account is frozen. It can receive money, but withdrawals and transfers out are blocked. Please contact the bank.")),
    h("div", { class: "actions" },
      btn("primary", "Deposit", { icon: "down", onclick: () => moneyDialog("deposit", a, refresh) }),
      btn("secondary", "Withdraw", { icon: "up", disabled: frozen, onclick: () => moneyDialog("withdraw", a, refresh) })));
}

/** Tappable account row for the home screen. */
function accountRow(a: Account): HTMLElement {
  const frozen = a.status === "frozen";
  return h("a", { class: `card acct-link${frozen ? " is-frozen" : ""}`, href: `#/account/${a.id}`,
    "aria-label": `${a.kind} account ${a.number}, balance ${peso(a.balance)}${frozen ? ", frozen" : ""}` },
    h("span", { class: "acct-badge" }, icon("wallet", 26)),
    h("div", { class: "acct-left" },
      h("strong", null, a.kind), h("span", { class: "muted" }, a.number),
      frozen && h("span", { class: "tag danger" }, icon("lock", 14), "Frozen · receiving only")),
    h("div", { class: "acct-right" }, h("span", { class: "muted label" }, "Balance"), h("strong", { class: "acct-balance" }, peso(a.balance))),
    icon("chevron", 20));
}

const HIDE_KEY = "hideBalance";
const balanceHidden = (): boolean => { try { return localStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } };

function tile(label: string, i: IconName, o: { onclick?: () => void; href?: string; disabled?: boolean }): HTMLElement {
  const inner = [h("span", { class: "tile-icon" }, icon(i, 30)), h("span", { class: "tile-label" }, label)];
  return o.href ? h("a", { class: "tile", href: o.href }, ...inner)
    : h("button", { class: "tile", type: "button", disabled: o.disabled, onclick: o.onclick }, ...inner);
}

export async function dashboardView(user: User): Promise<HTMLElement> {
  const accountsBox = h("div", { class: "stack" });
  const recentBox = h("ul", { class: "tx-list" });
  const recentTitle = h("h2", { id: "h-recent" }, "Recent activity");
  let recentRows: HTMLElement[] = [];
  const tiles = h("div", { class: "tiles" });
  const amount = h("p", { class: "hero-amount", "aria-live": "polite" }, "…");
  const count = h("p", { class: "hero-sub" });
  let total = 0;
  let hidden = balanceHidden();

  const eye = h("button", { type: "button", class: "eye", onclick: () => {
    hidden = !hidden;
    try { localStorage.setItem(HIDE_KEY, hidden ? "1" : "0"); } catch { /* still works this visit */ }
    paint();
  } });
  function paint() {
    amount.textContent = hidden ? "₱ ••••••" : peso(total);
    eye.setAttribute("aria-label", hidden ? "Show balance" : "Hide balance");
    eye.setAttribute("aria-pressed", String(hidden));
    eye.replaceChildren(icon(hidden ? "eyeOff" : "eye", 20));
  }

  const load = async () => {
    const { accounts } = await api<{ accounts: Account[] }>("GET", "/api/accounts");
    total = accounts.reduce((s, a) => s + a.balance, 0);
    paint();
    count.textContent = `Across ${accounts.length} account${accounts.length === 1 ? "" : "s"}`;
    const first = accounts.find((a) => a.status === "active") ?? accounts[0];
    tiles.replaceChildren(
      tile("Deposit", "down", { onclick: () => moneyDialog("deposit", first, load, accounts) }),
      tile("Withdraw", "up", { disabled: !accounts.some((a) => a.status === "active"), onclick: () => moneyDialog("withdraw", first, load, accounts) }),
      tile("Activity", "list", { href: `#/account/${first.id}` }),
      tile("Statements", "receipt", { href: `#/account/${first.id}/statements` }));
    accountsBox.replaceChildren(...accounts.map(accountRow));
    const pages = await Promise.all(accounts.map((a) => api<HistoryPage>("GET", `/api/accounts/${a.id}/transactions?page=1`)
      .then((p) => p.items.slice(0, 6).map((t) => ({ t, label: a.number })))));
    const latest = pages.flat().sort((x, y) => y.t.createdAt.localeCompare(x.t.createdAt) || y.t.id - x.t.id).slice(0, 6);
    recentRows = latest.length ? latest.map((r: { t: Tx; label: string }) => txRow(r.t, accounts.length > 1 ? r.label : undefined)) : [h("li", null, emptyState("No activity yet", "Your deposits, withdrawals and transfers will show up here."))];
    if (searchInput.value.trim()) await runSearch(); else showRecent();
  };

  function showRecent() { recentTitle.textContent = "Recent activity"; recentBox.replaceChildren(...recentRows); }

  // Search across every account: note, amount (like 1500), type or account number.
  let searchSeq = 0;
  async function runSearch() {
    const q = searchInput.value.trim();
    const mine = ++searchSeq;
    if (!q) return showRecent();
    try {
      const res = await api<{ items: SearchHit[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`);
      if (mine !== searchSeq) return; // a newer search is already running
      recentTitle.textContent = `Results for “${q}”`;
      recentBox.replaceChildren(...(res.items.length ? res.items.map((t) => txRow(t, t.accountNumber))
        : [h("li", null, emptyState("No matches", "Try a note, an amount like 1500, a type like Deposit, or an account number.", "search"))]));
    } catch (err) { toast(err instanceof ApiError ? err.message : "Search failed.", "error"); }
  }
  const searchInput = h("input", { id: "home-search", type: "search", maxlength: 60, autocomplete: "off", placeholder: "Search transactions", "aria-label": "Search transactions" });
  let searchTimer: number | undefined;
  searchInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(() => void runSearch(), 250); });

  const kind = h("select", { id: "kind", "aria-label": "Account type" }, h("option", { value: "Savings" }, "Savings"), h("option", { value: "Checking" }, "Checking"));
  const open = btn("secondary", "Open account", { icon: "plus", onclick: async () => {
    open.disabled = true;
    try {
      await api("POST", "/api/accounts", { kind: kind.value });
      toast("New account opened with a ₱5,000.00 opening deposit.");
      await load();
    } catch (err) { toast(err instanceof ApiError ? err.message : "Could not open account.", "error"); }
    finally { open.disabled = false; }
  } });

  await load();
  const first = user.fullName.split(" ")[0];
  return h("main", { class: "page" },
    h("h1", { class: "sr-only" }, `Hello, ${first}`),
    h("div", { class: "search wide", role: "search" }, icon("search", 18), searchInput),
    h("section", { class: "hero", "aria-label": "Total balance" },
      h("p", { class: "hero-hello" }, `Hello, ${first}`),
      h("div", { class: "hero-row" }, h("p", { class: "hero-label" }, "Total balance"), eye),
      amount, count),
    h("section", { class: "card quick", "aria-label": "Quick actions" }, tiles),
    h("section", { "aria-labelledby": "h-accts" }, h("h2", { id: "h-accts" }, "My accounts"), accountsBox),
    h("section", { class: "card", "aria-labelledby": "h-recent", "aria-live": "polite" }, recentTitle, recentBox),
    h("section", { class: "card slim row gap center wrap", "aria-label": "Open another account" },
      h("div", { class: "grow" }, h("strong", null, "Need another account?"), h("p", { class: "muted" }, "Every new account starts with ₱5,000.00.")),
      h("label", { class: "sr-only", for: "kind" }, "Account type"), kind, open));
}
