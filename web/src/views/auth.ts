import { api, ApiError, User } from "../api";
import { h, btn, field } from "../util";
import { icon } from "../icons";
import { themeToggle } from "../theme";

const PERKS = [
  { i: "swap", t: "Send money in seconds", d: "Transfer between accounts with a clear review step." },
  { i: "shield", t: "Rules the database enforces", d: "No overdrafts, frozen-account checks and a ledger that can't be edited." },
  { i: "list", t: "Statements you can keep", d: "Print or download any month's activity." },
] as const;

function authForm(mode: "login" | "register", onAuthed: (u: User) => void): HTMLElement {
  const isLogin = mode === "login";
  const banner = h("p", { class: "notice danger", role: "alert", hidden: true });
  const fullName = field({ id: "fullName", label: "Full name", attrs: { autocomplete: "name", maxlength: 80, required: true } });
  const username = field({ id: "username", label: "Username", hint: isLogin ? undefined : "3–32 letters, numbers or underscores.", attrs: { autocomplete: "username", required: true, autocapitalize: "none", spellcheck: "false" } });
  const password = field({ id: "password", label: "Password", type: "password", group: true, hint: isLogin ? undefined : "At least 8 characters, with a letter and a number.",
    attrs: { autocomplete: isLogin ? "current-password" : "new-password", required: true } });

  // Show/hide password: a real button with a text label for screen readers.
  const toggle = h("button", { type: "button", class: "icon-btn", "aria-label": "Show password", "aria-pressed": "false", onclick: () => {
    const show = password.input.type === "password";
    password.input.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    toggle.replaceChildren(icon(show ? "eyeOff" : "eye", 20));
  } }, icon("eye", 20));
  password.control.append(toggle);

  const submit = btn("primary", isLogin ? "Sign in" : "Create account", { type: "submit" });
  submit.classList.add("block");

  const form = h("form", { novalidate: true, onsubmit: async (e: Event) => {
    e.preventDefault();
    banner.hidden = true; fullName.error(null); username.error(null); password.error(null);
    let bad = false;
    if (!isLogin && !fullName.input.value.trim()) { fullName.error("Enter your full name."); bad = true; }
    if (!username.input.value.trim()) { username.error("Enter your username."); bad = true; }
    if (!password.input.value) { password.error("Enter your password."); bad = true; }
    if (bad) return;
    submit.disabled = true;
    try {
      const body = isLogin ? { username: username.input.value.trim(), password: password.input.value }
        : { username: username.input.value.trim(), password: password.input.value, fullName: fullName.input.value };
      const res = await api<{ user: User }>("POST", isLogin ? "/api/login" : "/api/register", body);
      onAuthed(res.user);
    } catch (err) {
      const e = err instanceof ApiError ? err : null;
      if (e?.code === "WEAK_PASSWORD") password.error(e.message);
      else if (e?.code === "INVALID_USERNAME" || e?.code === "USERNAME_TAKEN") username.error(e.message);
      else { banner.replaceChildren(icon("alert", 18), h("span", null, e?.message ?? "Something went wrong. Please try again.")); banner.hidden = false; }
    } finally { submit.disabled = false; }
  } }, !isLogin && fullName.root, username.root, password.root, banner, submit);

  const demo = isLogin && h("div", { class: "demo" },
    h("p", { class: "muted" }, "Demo accounts for this coursework project:"),
    h("div", { class: "row gap wrap" },
      ...([["Customer", "juan", "Juan#2026"], ["Admin", "admin", "Admin#2026"]] as const).map(([name, u, p]) =>
        btn("secondary", `Fill ${name}`, { small: true, onclick: () => { username.input.value = u; password.input.value = p; submit.focus(); } }))));

  return h("div", { class: "auth" },
    h("aside", { class: "auth-brand" },
      h("div", { class: "brand light" }, h("span", { class: "logo", "aria-hidden": "true" }, icon("star", 18)), "Tala Bank"),
      h("div", null,
        h("h2", null, "Everyday banking, kept simple."),
        h("ul", { class: "perks" }, ...PERKS.map((p) => h("li", null, h("span", { class: "perk-icon" }, icon(p.i, 20)), h("div", null, h("strong", null, p.t), h("p", null, p.d)))))),
      h("p", { class: "fine" }, "Coursework demo. No real money is moved.")),
    h("main", { class: "auth-main" },
      h("div", { class: "auth-theme" }, themeToggle()),
      h("section", { class: "auth-card" },
        h("div", { class: "brand dark-text only-mobile" }, h("span", { class: "logo", "aria-hidden": "true" }, icon("star", 18)), "Tala Bank"),
        h("h1", null, isLogin ? "Welcome back" : "Open your account"),
        h("p", { class: "muted" }, isLogin ? "Sign in to see your accounts." : "New accounts start with a ₱5,000.00 opening deposit."),
        form, demo,
        h("p", { class: "switch" }, isLogin ? "New to Tala Bank? " : "Already a customer? ",
          h("a", { href: isLogin ? "#/register" : "#/login" }, isLogin ? "Open an account" : "Sign in")))));
}

export const loginView = (onAuthed: (u: User) => void) => authForm("login", onAuthed);
export const registerView = (onAuthed: (u: User) => void) => authForm("register", onAuthed);
