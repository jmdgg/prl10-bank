import { api, ApiError, User } from "./api";
import { h, btn, toast, skeleton, initials, emptyState } from "./util";
import { icon, IconName } from "./icons";
import { themeToggle } from "./theme";
import { loginView, registerView } from "./views/auth";
import { dashboardView } from "./views/dashboard";
import { accountView } from "./views/account";
import { transferView } from "./views/transfer";
import { adminView } from "./views/admin";

const app = document.getElementById("app")!;
let user: User | null = null;
let renderId = 0; // ignore results from a page the user already left

function go(hash: string) { if (location.hash === hash) void route(); else location.hash = hash; }
function authed(u: User) { user = u; go(u.role === "admin" ? "#/admin" : "#/"); }
async function signOut() { await api("POST", "/api/logout").catch(() => {}); user = null; go("#/login"); }

interface NavItem { href: string; label: string; icon: IconName; match: (h: string) => boolean }
const navFor = (u: User): NavItem[] => u.role === "admin"
  ? [{ href: "#/admin", label: "Admin", icon: "shield", match: () => true }]
  : [{ href: "#/", label: "Home", icon: "home", match: (x) => x === "#/" || x.startsWith("#/account/") },
     { href: "#/transfer", label: "Transfer", icon: "swap", match: (x) => x === "#/transfer" }];

const brand = () => h("a", { class: "brand", href: "#/" }, h("span", { class: "logo", "aria-hidden": "true" }, icon("star", 18)), "Tala Bank");

/** Sidebar on desktop; compact top bar + bottom tab bar on phones. Each destination appears once per layout. */
function shell(u: User, hash: string, content: HTMLElement): HTMLElement {
  const links = (cls: string) => navFor(u).map((n) =>
    h("a", { href: n.href, class: cls, "aria-current": n.match(hash) ? "page" : null }, icon(n.icon, 22), h("span", null, n.label)));
  return h("div", { class: "app" },
    h("a", { class: "skip", href: "#content" }, "Skip to content"),
    h("aside", { class: "sidebar" },
      brand(),
      h("nav", { "aria-label": "Main" }, ...links("nav-link")),
      h("div", { class: "userbox" },
        h("span", { class: "avatar", "aria-hidden": "true" }, initials(u.fullName)),
        h("div", { class: "who" }, h("strong", null, u.fullName), h("span", null, u.role === "admin" ? "Administrator" : "Customer")),
        themeToggle(),
        btn("secondary", "Sign out", { icon: "logout", small: true, onclick: signOut }))),
    h("header", { class: "mobilebar" }, brand(),
      h("div", { class: "row gap center" }, themeToggle(true), btn("secondary", "Sign out", { icon: "logout", small: true, label: "Sign out", onclick: signOut }))),
    h("div", { id: "content", class: "content", tabindex: "-1" }, content),
    h("nav", { class: "tabbar", "aria-label": "Main" }, ...links("tab-link")));
}

async function route() {
  const id = ++renderId;
  const hash = location.hash || "#/";
  if (!user) {
    try { user = (await api<{ user: User }>("GET", "/api/me")).user; } catch { /* not signed in */ }
  }
  if (id !== renderId) return;
  if (!user) {
    app.replaceChildren(hash === "#/register" ? registerView(authed) : loginView(authed));
    if (hash !== "#/register" && hash !== "#/login") history.replaceState(null, "", "#/login");
    return;
  }
  if (hash === "#/login" || hash === "#/register") return go(user.role === "admin" ? "#/admin" : "#/");

  const content = h("div", null, skeleton());
  app.replaceChildren(shell(user, hash, content));
  try {
    let view: HTMLElement;
    const acct = hash.match(/^#\/account\/(\d+)(\/statements)?$/);
    if (acct && user.role === "customer") view = await accountView(Number(acct[1]));
    else if (hash === "#/transfer" && user.role === "customer") view = await transferView();
    else if (hash === "#/admin" && user.role === "admin") view = await adminView();
    else if (hash === "#/") view = user.role === "admin" ? await adminView() : await dashboardView(user);
    else view = h("main", { class: "page narrow" }, emptyState("Page not found", "That page doesn't exist.", "search"), h("p", null, h("a", { class: "btn primary", href: "#/" }, "Back home")));
    if (id !== renderId) return;
    content.replaceChildren(view);
    document.title = `${view.querySelector("h1")?.textContent ?? "Tala Bank"} · Tala Bank`;
    document.getElementById("content")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (hash.endsWith("/statements")) document.getElementById("h-stmt")?.scrollIntoView({ block: "start" });
  } catch (err) {
    if (id !== renderId) return;
    if (err instanceof ApiError && err.status === 401) { user = null; return go("#/login"); }
    const msg = err instanceof ApiError ? err.message : "Something went wrong.";
    content.replaceChildren(h("main", { class: "page narrow" }, emptyState("We couldn't load this page", msg, "alert"),
      h("div", { class: "row gap center-x" }, btn("primary", "Try again", { onclick: () => void route() }))));
    if (!(err instanceof ApiError && err.status === 404)) toast(msg, "error");
  }
}

window.addEventListener("hashchange", () => void route());
void route();
