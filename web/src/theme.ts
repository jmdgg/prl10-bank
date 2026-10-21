import { h } from "./util";
import { icon } from "./icons";

type Theme = "light" | "dark";
const root = document.documentElement;

/** What the user is looking at right now: their choice, else the system setting. */
const current = (): Theme =>
  (root.dataset.theme as Theme | undefined) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** Switches between light and dark and remembers the choice (index.html re-applies it before first paint). */
export function themeToggle(iconOnly = false): HTMLButtonElement {
  const b = h("button", { type: "button", class: `btn secondary sm${iconOnly ? " icon-only" : ""}` });
  const paint = () => {
    const goingTo: Theme = current() === "dark" ? "light" : "dark";
    const label = goingTo === "light" ? "Light mode" : "Dark mode";
    b.setAttribute("aria-label", `Switch to ${label.toLowerCase()}`);
    b.replaceChildren(icon(goingTo === "light" ? "sun" : "moon", 18), ...(iconOnly ? [] : [h("span", null, label)]));
  };
  b.addEventListener("click", () => {
    const next: Theme = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* private mode: still works for this visit */ }
    paint();
  });
  paint();
  return b;
}
