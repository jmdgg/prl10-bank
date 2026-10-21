import { api, Account, HistoryPage } from "../api";
import { h, btn, linkBtn, emptyState, monthNow } from "../util";
import { accountCard } from "./dashboard";
import { txRow } from "./tx";

const KINDS = ["Deposit", "Withdrawal", "Transfer In", "Transfer Out"];

export async function accountView(id: number): Promise<HTMLElement> {
  let page = 1;
  const type = h("select", { id: "f-type" }, h("option", { value: "" }, "All types"), ...KINDS.map((k) => h("option", { value: k }, k)));
  const search = h("input", { id: "f-q", type: "search", maxlength: 60, autocomplete: "off", placeholder: "Note, amount or type" });
  const from = h("input", { id: "f-from", type: "date" });
  const to = h("input", { id: "f-to", type: "date" });
  const month = h("input", { id: "f-month", type: "month", value: monthNow() });
  const list = h("ul", { class: "tx-list" });
  const pager = h("div", { class: "row between center wrap gap pager" });
  const head = h("div");
  const crumb = h("span", { "aria-current": "page" }, "Account");
  const title = h("h1", { class: "sr-only" }, "Account activity"); // gives the page a heading and tab title

  async function loadHeader() {
    const { account } = await api<{ account: Account }>("GET", `/api/accounts/${id}`);
    crumb.textContent = `${account.kind} ${account.number}`;
    title.textContent = `${account.kind} account activity`;
    head.replaceChildren(accountCard(account, reload));
  }

  async function loadRows() {
    const q = new URLSearchParams({ page: String(page), type: type.value, from: from.value, to: to.value, q: search.value.trim() });
    const res = await api<HistoryPage>("GET", `/api/accounts/${id}/transactions?${q}`);
    list.replaceChildren(...(res.items.length ? res.items.map((t) => txRow(t)) : [h("li", null, emptyState("Nothing to show", "No transactions match your search or filters.", "search"))]));
    const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
    pager.replaceChildren(
      h("span", { class: "muted" }, `${res.total} transaction${res.total === 1 ? "" : "s"} · page ${res.page} of ${pages}`),
      h("div", { class: "row gap" },
        btn("secondary", "Previous", { small: true, disabled: page <= 1, onclick: () => { page--; void loadRows(); } }),
        btn("secondary", "Next", { small: true, disabled: page >= pages, onclick: () => { page++; void loadRows(); } })));
  }

  const reload = async () => { await Promise.all([loadHeader(), loadRows()]); };
  for (const el of [type, from, to]) el.addEventListener("change", () => { page = 1; void loadRows(); });
  let searchTimer: number | undefined;
  search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { page = 1; void loadRows(); }, 250); });

  const stmt = (format: string) => `/api/accounts/${id}/statement?month=${month.value}&format=${format}`;
  await reload();
  return h("main", { class: "page" }, title,
    h("nav", { class: "crumbs", "aria-label": "Breadcrumb" }, h("a", { href: "#/" }, "Accounts"), h("span", { "aria-hidden": "true" }, "/"), crumb),
    head,
    h("section", { class: "card", "aria-labelledby": "h-hist" },
      h("h2", { id: "h-hist" }, "Transaction history"),
      h("div", { class: "filters" },
        h("div", { class: "grow-field" }, h("label", { for: "f-q" }, "Search"), search),
        h("div", null, h("label", { for: "f-type" }, "Type"), type),
        h("div", null, h("label", { for: "f-from" }, "From"), from),
        h("div", null, h("label", { for: "f-to" }, "To"), to)),
      list, pager),
    h("section", { class: "card", "aria-labelledby": "h-stmt" },
      h("h2", { id: "h-stmt" }, "Monthly statement"),
      h("p", { class: "muted" }, "Pick a month, then view a printable copy or download it as a spreadsheet."),
      h("div", { class: "filters" },
        h("div", null, h("label", { for: "f-month" }, "Month"), month),
        h("div", { class: "row gap wrap end-self" },
          linkBtn("secondary", "View / print", "#", { icon: "print", onclick: (e) => { e.preventDefault(); window.open(stmt("html"), "_blank"); } }),
          linkBtn("secondary", "Download CSV", "#", { icon: "download", onclick: (e) => { e.preventDefault(); location.href = stmt("csv"); } })))));
}
