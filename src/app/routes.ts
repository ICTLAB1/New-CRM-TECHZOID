/**
 * Which screen a URL means, and which URL a screen has.
 *
 * WHY THE APP HAS URLS AT ALL. It is one page, and until now every screen
 * lived at "/" — so the browser's Back button had nothing of the CRM to go
 * back to and left the app entirely, which on a phone is the same gesture
 * people use to close anything. Pressing Back in the middle of work and
 * landing on a sign-in screen is not a navigation bug, it is losing your
 * place.
 *
 * A LIST OF KNOWN SCREENS, not a pattern. Anything unrecognised is the
 * dashboard: the paths a stranger can arrive on are /p/<token> for the
 * customer portal and /r/<code> for a registration link, both answered
 * before the CRM is ever rendered, and neither may be swallowed by a
 * fallback that treats the first path segment as a screen name.
 */

/** Every screen the workbench can show. The dashboard lives at "/". */
export const VIEWS: readonly string[] = [
  "dashboard",
  "activity", "assistant", "campaigns", "catalog", "companies", "components",
  "customers", "discount-approvals", "dispatch", "incentives", "integrations",
  "invoices", "mail", "orders", "payment-tracker", "pipeline", "price-book",
  "proformas", "prospects", "purchase-orders", "quotations", "receivables",
  "renewals", "reports", "scan", "settings", "subscriptions", "tasks", "team",
];

const KNOWN = new Set(VIEWS);

export const HOME = "dashboard";

/** Where a screen lives. The dashboard is the root, so Back from the first
 *  screen somebody opened lands on something that is theirs. */
export function pathForView(view: string): string {
  const v = String(view ?? "").trim();
  return !v || v === HOME || !KNOWN.has(v) ? "/" : `/${v}`;
}

/**
 * The screen a path means, or "" when the path is not one of ours.
 *
 * "" rather than the dashboard, deliberately: the caller decides what to do
 * with a path it does not recognise, and the one caller that matters —
 * arriving on a portal link — must not be told "that is the dashboard".
 */
export function viewForPath(pathname: string): string {
  const path = String(pathname ?? "").trim();
  if (path === "" || path === "/") return HOME;
  const match = /^\/([^/?#]+)\/?$/.exec(path);
  if (!match) return "";
  const candidate = decodeURIComponent(match[1] ?? "").trim().toLowerCase();
  return KNOWN.has(candidate) ? candidate : "";
}

/** The screen to show on arrival: whatever the URL says, else home. */
export const viewOnArrival = (pathname: string): string => viewForPath(pathname) || HOME;
