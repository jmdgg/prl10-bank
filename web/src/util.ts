import { icon, IconName } from "./icons";

type Kid = Node | string | number | null | undefined | false;

/** Tiny DOM builder. Text is always appended as text nodes, so user data can't inject markup. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: Record<string, unknown> | null = null, ...kids: Kid[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class") el.className = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

// ---- formatting ----------------------------------------------------------

const pesoFmt = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
export const peso = (centavos: number): string => pesoFmt.format(centavos / 100);
export const pesoWhole = (pesos: number): string => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(pesos);

function parseWhen(s: string): Date { return new Date(s.replace(" ", "T")); }
export function when(s: string): string {
  const d = parseWhen(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
}
export function whenShort(s: string): string {
  const d = parseWhen(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export const monthNow = (): string => new Date().toLocaleDateString("sv-SE").slice(0, 7); // YYYY-MM
export const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

/** Mirrors the server's amount rules so mistakes are caught before a request is sent. */
export function checkAmount(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const s = raw.trim().replace(/^₱\s*/, "").replace(/,/g, "");
  if (s === "") return { ok: false, message: "Enter an amount." };
  if (/^-\d*\.?\d+$/.test(s) || /^0+(\.0{1,2})?$/.test(s)) return { ok: false, message: "Amount must be greater than zero." };
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return { ok: false, message: "Use numbers only, like 500 or 250.75." };
  if (Number(s) > 1_000_000) return { ok: false, message: "Amount exceeds the ₱1,000,000 per-transaction limit." };
  return { ok: true, value: s };
}

// ---- building blocks -----------------------------------------------------

type Variant = "primary" | "secondary" | "danger" | "text";
interface BtnOpts { icon?: IconName; onclick?: (e: Event) => void; type?: "button" | "submit"; small?: boolean; disabled?: boolean; label?: string }

const cls = (v: Variant, small?: boolean) => `btn ${v}${small ? " sm" : ""}`;
const content = (label: string, i?: IconName): Node[] => [i ? icon(i, 18) : "", h("span", null, label)].filter((x) => x !== "") as Node[];

/** The only four button looks in the app: primary, secondary, danger, text. One primary per area. */
export function btn(variant: Variant, label: string, o: BtnOpts = {}): HTMLButtonElement {
  return h("button", { class: cls(variant, o.small), type: o.type ?? "button", disabled: o.disabled, "aria-label": o.label, onclick: o.onclick }, ...content(label, o.icon));
}
export function linkBtn(variant: Variant, label: string, href: string, o: Pick<BtnOpts, "icon" | "small" | "onclick"> = {}): HTMLAnchorElement {
  return h("a", { class: cls(variant, o.small), href, onclick: o.onclick }, ...content(label, o.icon));
}

/** Labelled input with helper text and an error slot right under it (not at the top of the page). */
export function field(o: { id: string; label: string; type?: string; hint?: string; prefix?: string; group?: boolean; attrs?: Record<string, unknown>; optional?: boolean }) {
  const input = h("input", { id: o.id, name: o.id, type: o.type ?? "text", "aria-describedby": `${o.id}-msg`, ...(o.attrs ?? {}) });
  const msg = h("p", { id: `${o.id}-msg`, class: "field-msg", "aria-live": "polite" }, o.hint);
  // `group` gives a wrapper that callers can append a trailing control to (e.g. show/hide password).
  const control: HTMLElement = o.prefix || o.group
    ? h("div", { class: "input-group" }, o.prefix && h("span", { class: "prefix", "aria-hidden": "true" }, o.prefix), input)
    : input;
  const root = h("div", { class: "field" },
    h("label", { for: o.id }, o.label, o.optional && h("span", { class: "opt" }, " (optional)")), control, msg);
  let hint = o.hint;
  return {
    root, input, control,
    setHint(t: string) { hint = t; msg.className = "field-msg"; msg.replaceChildren(t); },
    error(m: string | null) {
      msg.className = m ? "field-msg error" : "field-msg";
      msg.replaceChildren(...(m ? [icon("alert", 16), h("span", null, m)] : hint ? [hint] : []));
      if (m) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    },
    success(nodes: (Node | string)[]) {
      msg.className = "field-msg ok";
      msg.replaceChildren(...nodes);
      input.removeAttribute("aria-invalid");
    },
  };
}

export function skeleton(): HTMLElement {
  return h("div", { class: "page", "aria-busy": "true", "aria-label": "Loading" },
    h("div", { class: "skel title" }), h("div", { class: "skel card" }), h("div", { class: "skel card" }));
}

export function emptyState(title: string, text: string, i: IconName = "inbox"): HTMLElement {
  return h("div", { class: "empty" }, h("span", { class: "empty-icon" }, icon(i, 28)), h("strong", null, title), h("p", { class: "muted" }, text));
}

export function toast(message: string, kind: "ok" | "error" = "ok"): void {
  const box = document.getElementById("toasts")!;
  const t = h("div", { class: `toast ${kind}`, role: kind === "error" ? "alert" : "status" }, icon(kind === "ok" ? "check" : "alert", 18), h("span", null, message));
  box.append(t);
  setTimeout(() => t.remove(), 4500);
}

export async function copyText(text: string, what: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied.`); }
  catch { toast("Couldn't copy. Select the text and copy it manually.", "error"); }
}
