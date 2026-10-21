import { Tx } from "../api";
import { h, peso, whenShort } from "../util";
import { icon } from "../icons";

export const isCredit = (t: Tx): boolean => t.kind === "Deposit" || t.kind === "Transfer In";

/** One transaction as a row: icon + sign + words, so meaning never depends on colour alone. */
export function txRow(t: Tx, accountLabel?: string): HTMLElement {
  const credit = isCredit(t);
  const detail = [t.counterparty && `${t.kind === "Transfer In" ? "from" : "to"} ${t.counterparty}`, t.note, accountLabel].filter(Boolean).join(" · ");
  return h("li", { class: "tx" },
    h("span", { class: `tx-icon ${credit ? "in" : "out"}` }, icon(t.kind.startsWith("Transfer") ? "swap" : credit ? "down" : "up", 22)),
    h("div", { class: "tx-main" }, h("strong", null, t.kind), h("span", { class: "muted" }, [whenShort(t.createdAt), detail].filter(Boolean).join(" · "))),
    h("div", { class: "tx-amt" },
      h("strong", { class: credit ? "pos" : "neg" }, `${credit ? "+" : "−"}${peso(t.amount)}`),
      h("span", { class: "muted" }, `Balance ${peso(t.balanceAfter)}`)));
}
