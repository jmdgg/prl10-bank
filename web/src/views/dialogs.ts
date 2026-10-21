import { api, ApiError, Account } from "../api";
import { h, btn, field, checkAmount, peso, pesoWhole, toast } from "../util";
import { icon, IconName } from "../icons";

function openModal(label: string, children: Node[]): HTMLDialogElement {
  const dlg = h("dialog", { class: "modal", "aria-label": label }, ...children);
  dlg.addEventListener("close", () => dlg.remove()); // Esc and Cancel both land here
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

const heading = (i: IconName, tone: string, title: string, sub: string) =>
  h("div", { class: "modal-head" }, h("span", { class: `badge-icon ${tone}` }, icon(i, 22)), h("div", null, h("h2", null, title), h("p", { class: "muted" }, sub)));

/** Deposit / withdraw. With several accounts the dialog lets you pick which one. Errors stay beside the field. */
export function moneyDialog(kind: "deposit" | "withdraw", account: Account, onDone: () => void, accounts: Account[] = [account]): void {
  const deposit = kind === "deposit";
  const verb = deposit ? "Deposit" : "Withdraw";
  const choices = accounts.filter((a) => deposit || a.status === "active"); // frozen accounts can still receive money
  let acct = choices.find((a) => a.id === account.id) ?? choices[0] ?? account;
  const hintFor = (a: Account) => (deposit ? "Up to ₱1,000,000 per transaction." : `Available: ${peso(a.balance)}`);

  const amount = field({
    id: "amt", label: "Amount", prefix: "₱", hint: hintFor(acct),
    attrs: { type: "text", inputmode: "decimal", autocomplete: "off", placeholder: "0.00", required: true },
  });
  const note = field({ id: "note", label: "Note", optional: true, attrs: { maxlength: 80, autocomplete: "off" } });
  const submit = btn("primary", verb, { type: "submit", icon: deposit ? "down" : "up" });
  const cancel = btn("secondary", "Cancel", { onclick: () => dlg.close() });

  const where = h("span", { class: "muted" }, `${acct.kind} · ${acct.number}`);
  const bal = h("strong", null, peso(acct.balance));
  const pick = choices.length > 1 ? h("div", { class: "field" }, h("label", { for: "acct-pick" }, "Account"),
    h("select", { id: "acct-pick", onchange: (e: Event) => {
      acct = choices.find((a) => String(a.id) === (e.target as HTMLSelectElement).value) ?? acct;
      where.textContent = `${acct.kind} · ${acct.number}`; bal.textContent = peso(acct.balance);
      amount.setHint(hintFor(acct)); amount.error(null);
    } }, ...choices.map((a) => h("option", { value: a.id, selected: a.id === acct.id }, `${a.kind} ${a.number}`)))) : null;

  const chips = h("div", { class: "chips", role: "group", "aria-label": "Quick amounts" },
    ...[500, 1000, 5000].map((n) => h("button", { type: "button", class: "chip", onclick: () => {
      amount.input.value = String(n); amount.error(null); amount.input.focus();
    } }, pesoWhole(n))));

  const form = h("form", { novalidate: true, onsubmit: async (e: Event) => {
    e.preventDefault();
    amount.error(null);
    const check = checkAmount(amount.input.value);
    if (!check.ok) { amount.error(check.message); amount.input.focus(); return; }
    submit.disabled = true;
    try {
      const res = await api<{ account: Account }>("POST", `/api/accounts/${acct.id}/${kind}`, { amount: check.value, note: note.input.value });
      dlg.close();
      toast(`${verb} successful. New balance: ${peso(res.account.balance)}`);
      onDone();
    } catch (err) {
      amount.error(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      amount.input.focus();
    } finally { submit.disabled = false; }
  } },
    pick,
    h("div", { class: "balance-chip" }, where, bal),
    amount.root, chips, note.root,
    h("div", { class: "modal-actions" }, cancel, submit));

  const dlg = openModal(`${verb} money`, [heading(deposit ? "down" : "up", deposit ? "in" : "out", `${verb} money`, deposit ? "Add money to this account." : "Take money out of this account."), form]);
  amount.input.focus();
}

/** Plain-language confirmation for anything that changes an account on someone's behalf. */
export function confirmDialog(o: { title: string; message: string; confirmLabel: string; danger?: boolean; icon?: IconName; onConfirm: () => Promise<void> }): void {
  const confirm = btn(o.danger ? "danger" : "primary", o.confirmLabel, { onclick: async () => {
    confirm.disabled = true;
    try { await o.onConfirm(); dlg.close(); } catch (err) { toast(err instanceof ApiError ? err.message : "Action failed.", "error"); confirm.disabled = false; }
  } });
  const dlg = openModal(o.title, [
    heading(o.icon ?? "alert", o.danger ? "out" : "in", o.title, o.message),
    h("div", { class: "modal-actions" }, btn("secondary", "Cancel", { onclick: () => dlg.close() }), confirm)]);
}

export function limitDialog(account: Account, onDone: (pesos: string) => Promise<void>): void {
  const limit = field({ id: "limit", label: "Daily withdrawal limit", prefix: "₱", hint: `Currently ${peso(account.dailyLimit)}.`,
    attrs: { type: "text", inputmode: "decimal", autocomplete: "off", value: String(account.dailyLimit / 100) } });
  const save = btn("primary", "Save limit", { type: "submit" });
  const form = h("form", { novalidate: true, onsubmit: async (e: Event) => {
    e.preventDefault(); limit.error(null);
    const c = checkAmount(limit.input.value);
    if (!c.ok) return limit.error(c.message);
    save.disabled = true;
    try { await onDone(c.value); dlg.close(); } catch (err) { limit.error(err instanceof ApiError ? err.message : "Could not save."); save.disabled = false; }
  } }, limit.root, h("div", { class: "modal-actions" }, btn("secondary", "Cancel", { onclick: () => dlg.close() }), save));
  const dlg = openModal("Set daily limit", [heading("shield", "in", "Set daily limit", `${account.kind} · ${account.number}`), form]);
  limit.input.select();
}
