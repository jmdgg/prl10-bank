import { api, Account, AdminUser, AuditEntry, Overview } from "../api";
import { h, btn, peso, when, toast, emptyState } from "../util";
import { icon, IconName } from "../icons";
import { confirmDialog, limitDialog } from "./dialogs";

type Tab = "accounts" | "users" | "audit";

export async function adminView(): Promise<HTMLElement> {
  const stats = h("div", { class: "stats" });
  const panel = h("div", { class: "card flush" });
  let tab: Tab = "accounts";
  let query = "";

  const stat = (i: IconName, label: string, value: string) =>
    h("div", { class: "stat" }, h("span", { class: "badge-icon in" }, icon(i, 20)), h("div", null, h("span", { class: "muted" }, label), h("strong", null, value)));
  const table = (heads: string[], rows: (Node | string)[][]) => rows.length === 0 ? emptyState("Nothing here yet", "No records match.", "search") :
    h("div", { class: "table-wrap" }, h("table", null,
      h("thead", null, h("tr", null, ...heads.map((c) => h("th", { scope: "col" }, c)))),
      h("tbody", null, ...rows.map((r) => h("tr", null, ...r.map((c) => h("td", null, c)))))));

  async function afterChange() { await show(); }

  function accountRow(a: Account): (Node | string)[] {
    const frozen = a.status === "frozen";
    return [h("strong", null, a.number), a.owner, a.kind, peso(a.balance), peso(a.dailyLimit),
      h("span", { class: `tag ${frozen ? "danger" : "ok"}` }, frozen && icon("lock", 14), frozen ? "Frozen" : "Active"),
      h("div", { class: "row gap" },
        frozen
          ? btn("secondary", "Unfreeze", { small: true, icon: "check", onclick: () => confirmDialog({ title: "Unfreeze this account?", message: `${a.owner} (${a.number}) will be able to withdraw and transfer again.`,
              confirmLabel: "Unfreeze account", icon: "check", onConfirm: async () => { await api("POST", `/api/admin/accounts/${a.id}/unfreeze`); toast("Account unfrozen."); await afterChange(); } }) })
          : btn("danger", "Freeze", { small: true, icon: "lock", onclick: () => confirmDialog({ title: "Freeze this account?", message: `${a.owner} (${a.number}) will still receive money but won't be able to withdraw or transfer out.`,
              confirmLabel: "Freeze account", danger: true, icon: "lock", onConfirm: async () => { await api("POST", `/api/admin/accounts/${a.id}/freeze`); toast("Account frozen."); await afterChange(); } }) }),
        btn("secondary", "Set limit", { small: true, onclick: () => limitDialog(a, async (pesos) => { await api("POST", `/api/admin/accounts/${a.id}/limit`, { limit: pesos }); toast("Daily limit updated."); await afterChange(); }) }))];
  }

  async function show() {
    const o = await api<Overview>("GET", "/api/admin/overview");
    stats.replaceChildren(stat("users", "Customers", String(o.customers)), stat("wallet", "Accounts", String(o.accounts)),
      stat("shield", "Total deposits", peso(o.totalDeposits)), stat("lock", "Frozen accounts", String(o.frozenAccounts)), stat("swap", "Transactions today", String(o.transactionsToday)));

    if (tab === "accounts") {
      const { accounts } = await api<{ accounts: Account[] }>("GET", "/api/admin/accounts");
      const q = query.trim().toLowerCase();
      const rows = accounts.filter((a) => !q || `${a.number} ${a.owner} ${a.kind}`.toLowerCase().includes(q)).map(accountRow);
      const search = h("input", { id: "acct-search", type: "search", placeholder: "Search by name or number", value: query, "aria-label": "Search accounts",
        oninput: (e: Event) => { query = (e.target as HTMLInputElement).value; void show().then(() => document.getElementById("acct-search")?.focus()); } });
      panel.replaceChildren(h("div", { class: "toolbar" }, h("div", { class: "search" }, icon("search", 18), search)),
        table(["Account", "Owner", "Type", "Balance", "Daily limit", "Status", "Actions"], rows));
    } else if (tab === "users") {
      const { users } = await api<{ users: AdminUser[] }>("GET", "/api/admin/users");
      panel.replaceChildren(table(["Username", "Name", "Role", "Accounts", "Joined"], users.map((u) => [h("strong", null, u.username), u.fullName,
        h("span", { class: `tag ${u.role === "admin" ? "" : "ok"}` }, u.role), String(u.accounts), when(u.createdAt)])));
    } else {
      const { entries } = await api<{ entries: AuditEntry[] }>("GET", "/api/admin/audit");
      panel.replaceChildren(table(["When", "User", "Action", "Detail"], entries.map((e) => [when(e.createdAt), e.user || "—", h("span", { class: "tag" }, e.action), e.detail])));
    }
  }

  const labels: Record<Tab, string> = { accounts: "Accounts", users: "Users", audit: "Audit log" };
  const tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Admin sections" }, ...(Object.keys(labels) as Tab[]).map((t) =>
    h("button", { role: "tab", type: "button", class: "tab", "aria-selected": String(t === tab), onclick: (e: Event) => {
      tab = t;
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b === e.currentTarget)));
      void show();
    } }, labels[t])));

  await show();
  return h("main", { class: "page" },
    h("header", { class: "page-head" }, h("div", null, h("h1", null, "Administration"), h("p", { class: "muted" }, "Monitor accounts and keep customers safe."))),
    stats, tabs, panel);
}
