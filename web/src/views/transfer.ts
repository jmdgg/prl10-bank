import { api, ApiError, Account } from "../api";
import { h, btn, linkBtn, field, checkAmount, peso, toast, emptyState } from "../util";
import { icon } from "../icons";

interface Draft { fromId: number; to: string; amount: string; note: string }

export async function transferView(): Promise<HTMLElement> {
  const { accounts } = await api<{ accounts: Account[] }>("GET", "/api/accounts");
  const usable = accounts.filter((a) => a.status === "active");
  const stage = h("div");
  const steps = h("ol", { class: "steps", "aria-label": "Transfer progress" });
  const label = (a: Account) => `${a.kind} ${a.number} — ${peso(a.balance)}`;
  const find = (id: number) => accounts.find((a) => a.id === id)!;

  const setStep = (n: 1 | 2 | 3) => steps.replaceChildren(...["Details", "Review", "Done"].map((s, i) =>
    h("li", { class: i + 1 === n ? "current" : i + 1 < n ? "done" : "", "aria-current": i + 1 === n ? "step" : null },
      h("span", { class: "dot" }, i + 1 < n ? icon("check", 14) : String(i + 1)), s)));

  function details(d?: Draft, toError?: string) {
    setStep(1);
    const from = h("select", { id: "from" }, ...usable.map((a) => h("option", { value: a.id, selected: d?.fromId === a.id }, label(a))));
    const to = field({ id: "to", label: "To account number", hint: "Ask the recipient for their account number, like 1234-567890.",
      attrs: { type: "text", autocomplete: "off", placeholder: "0000-000000", value: d?.to ?? "", required: true } });
    const amount = field({ id: "amount", label: "Amount", prefix: "₱", attrs: { type: "text", inputmode: "decimal", autocomplete: "off", placeholder: "0.00", value: d?.amount ?? "", required: true } });
    const note = field({ id: "tnote", label: "Note", optional: true, attrs: { type: "text", maxlength: 80, value: d?.note ?? "" } });
    if (toError) to.error(toError);

    const form = h("form", { class: "card", novalidate: true, onsubmit: (e: Event) => {
      e.preventDefault();
      to.error(null); amount.error(null);
      const check = checkAmount(amount.input.value);
      if (!to.input.value.trim()) { to.error("Enter the destination account number."); to.input.focus(); return; }
      if (!check.ok) { amount.error(check.message); amount.input.focus(); return; }
      const src = find(Number(from.value));
      if (Math.round(Number(check.value) * 100) > src.balance) { amount.error(`This is more than the available ${peso(src.balance)}.`); amount.input.focus(); return; }
      review({ fromId: src.id, to: to.input.value.trim(), amount: check.value, note: note.input.value });
    } },
      h("div", { class: "field" }, h("label", { for: "from" }, "From account"), from),
      to.root, amount.root, note.root,
      h("div", { class: "form-actions" }, btn("primary", "Continue", { type: "submit", icon: "chevron" })));
    stage.replaceChildren(form);
    (toError ? to.input : from).focus();
  }

  function review(d: Draft) {
    setStep(2);
    const src = find(d.fromId);
    const cents = Math.round(Number(d.amount) * 100);
    const problem = h("p", { class: "notice danger", role: "alert", hidden: true });
    const send = btn("primary", `Send ${peso(cents)}`, { icon: "up", onclick: async () => {
      send.disabled = true; problem.hidden = true;
      try {
        const res = await api<{ account: Account }>("POST", "/api/transfers", { fromAccountId: d.fromId, toNumber: d.to, amount: d.amount, note: d.note });
        toast("Transfer sent.");
        done(d, res.account);
      } catch (err) {
        const e = err instanceof ApiError ? err : null;
        if (e && (e.code === "DEST_NOT_FOUND" || e.code === "SAME_ACCOUNT")) return details(d, e.message);
        problem.replaceChildren(icon("alert", 18), h("span", null, e?.message ?? "Something went wrong. Please try again."));
        problem.hidden = false; send.disabled = false;
      }
    } });
    stage.replaceChildren(h("section", { class: "card review", "aria-labelledby": "h-review" },
      h("h2", { id: "h-review" }, "Check the details"),
      h("p", { class: "muted" }, "Money moves as soon as you confirm. Please make sure everything is right."),
      h("dl", null,
        h("dt", null, "From"), h("dd", null, `${src.kind} ${src.number}`),
        h("dt", null, "To"), h("dd", null, d.to),
        h("dt", null, "Amount"), h("dd", { class: "big" }, peso(cents)),
        d.note && h("dt", null, "Note"), d.note && h("dd", null, d.note)),
      problem,
      h("div", { class: "form-actions" }, btn("secondary", "Edit details", { icon: "back", onclick: () => details(d) }), send)));
    send.focus();
  }

  function done(d: Draft, after: Account) {
    setStep(3);
    stage.replaceChildren(h("section", { class: "card success", role: "status" },
      h("span", { class: "badge-icon in big" }, icon("check", 30)),
      h("h2", null, "Transfer sent"),
      h("p", null, `${peso(Math.round(Number(d.amount) * 100))} is on its way to ${d.to}.`),
      h("p", { class: "muted" }, `Your new balance is ${peso(after.balance)}.`),
      h("div", { class: "form-actions center" },
        linkBtn("secondary", "View activity", `#/account/${after.id}`, { icon: "list" }),
        btn("primary", "Make another transfer", { icon: "swap", onclick: () => details() }))));
  }

  if (usable.length) details();
  return h("main", { class: "page narrow" },
    h("header", { class: "page-head" }, h("div", null, h("h1", null, "Transfer money"), h("p", { class: "muted" }, "Send money to another Tala Bank account."))),
    usable.length === 0 ? emptyState("No active account", "You need an active account to send money.", "lock") : h("div", null, steps, stage));
}
