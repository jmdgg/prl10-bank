# Tala Bank — design breakdown

Direction: **mobile-wallet banking.** The layout patterns people already know from Philippine e-wallets (a bright blue header, a big balance card with a hide/show eye, round quick-action tiles, soft white cards, pill buttons, a bottom tab bar on phones), applied to Tala Bank's own brand. Only patterns are borrowed: no third-party logos, names, colours or assets.
Earlier experiments are kept for reference: `web/public/styles.soft.css` (calm navy) and `styles.neo.css` (neo-brutalist). To switch, copy one over `styles.css` and set the font link in `index.html` to match (Inter for this theme).

## Principles
1. **One obvious next step.** At most one solid (primary) button per area.
2. **Words on every button.** Icons support the label; on small screens icon-only controls carry an `aria-label`.
3. **Never colour alone.** Money in/out uses an icon, a +/− sign and a word as well as green/red.
4. **Say it where it happens.** Errors appear under the field with an icon and plain wording.
5. **Slow down only where it matters.** Transfers have a review step; freezing an account has a confirmation. Everyday deposits don't.
6. **Private by default.** The home balance can be hidden with the eye button (remembered on this device).

## Tokens (`web/public/styles.css`)
| Token | Light | Use |
|-------|-------|-----|
| `--brand-1` / `--brand-2` | `#0a4bd0` / `#1e6bf2` | Top bar, balance card, sign-in panel (white text ≥ 4.7:1) |
| `--primary` | `#1560f0` | Solid buttons, links, active states |
| `--primary-soft` | `#e8f0fe` | Tonal buttons, icon tiles, tags |
| `--ink` / `--muted` | `#0f1b33` / `#5a6782` | Text |
| `--success` / `--danger` | `#08794d` / `#c62828` | Money in / out, errors (≥ 4.5:1 on white and on their tints) |
| `--bg` / `--surface` / `--line` | `#f1f5fb` / `#fff` / `#e3e9f3` | Page, cards, dividers |

Type: Inter, tabular numerals for money. Radius 12–16px on cards, 20–24px on the balance card and dialogs, fully round buttons. Soft shadows, no heavy outlines. Light is the base theme; dark follows the system until the Light / Dark toggle is used.

## Buttons
| Kind | Looks | Used for |
|------|-------|----------|
| Primary | Solid blue pill | The main action: Deposit, Continue, Send ₱X, Sign in |
| Secondary | Pale-blue pill | Withdraw, Cancel, Edit details, downloads |
| Danger | Pale-red pill | Freeze account (confirmed in a dialog) |
| Text | Blue text | Low-weight links: Copy |

All are 40–48px tall with a visible focus ring, hover, pressed and disabled states.

## Layout
- **Desktop:** blue sidebar (brand, Home / Transfer, then user, theme toggle and Sign out at the bottom); content up to 1040px.
- **Phone:** compact blue top bar with icon buttons, plus a bottom tab bar (Home, Transfer) with large touch targets and safe-area padding.
- **No duplicate destinations:** pages are reached from the sidebar / tab bar; the Home quick actions are tasks (Deposit, Withdraw) and shortcuts (Activity, Statements), so Transfer appears once.
- Skip link, one `<h1>` per page, breadcrumb on the account page, focus moves to the page after each navigation.

## Screens
| Screen | What it has |
|--------|-------------|
| **Sign in / Register** | Blue brand panel + white form, show/hide password, inline field errors, demo-account fill buttons |
| **Home** | Search bar (transactions across all accounts: note, amount, type, account number), balance card with hide/show eye, quick actions (Deposit, Withdraw, Activity, Statements), tappable account rows, recent activity (becomes the search results), open another account |
| **Deposit / Withdraw dialog** | Account picker (when you have several), large ₱ amount, quick-amount chips, available balance, error under the field |
| **Account activity** | Breadcrumb, balance card with Deposit / Withdraw, search + type + date filters, transaction rows with balance after, paging, monthly statement (print / CSV) |
| **Transfer** | 3 steps (Details → Review → Done) with progress, exact amount on the confirm button, new balance on completion |
| **Admin** | Stat cards, pill tabs (Accounts / Users / Audit log), account search, status tags, confirmation dialogs for freeze / unfreeze, limit dialog |

## States covered
Loading (skeletons), empty (icon + message), error (inline, banner or retry panel), success (toast + visible change), frozen account, expired session, page not found.

## Accessibility
- Contrast ≥ 4.5:1 for text in light and dark; 3px focus ring; targets ≥ 44px on touch layouts.
- Visible labels, helper text linked with `aria-describedby`, errors announced via `aria-live`, `aria-invalid` on bad fields.
- Native `<dialog>` (focus trapped, Esc closes); toasts use `role="status"` / `role="alert"`.
- Icons are `aria-hidden`; `prefers-reduced-motion` turns off shimmer, press and dialog animation.

## Not done
No spending charts, notifications centre or settings page; not needed for the brief.
