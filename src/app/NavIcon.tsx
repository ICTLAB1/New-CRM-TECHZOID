/**
 * One line-drawn icon per navigation item.
 *
 * WHY ICONS AT ALL. The rail is read by someone scanning for a place
 * they already know, and a column of thirty words is read linearly while
 * a column of thirty shapes is read by position. The icon is what makes
 * the fourth item findable without reading the first three.
 *
 * DRAWN HERE RATHER THAN INSTALLED. An icon set is a dependency, a
 * licence and a build step for about forty paths; these are forty paths.
 * They share one grid (24), one stroke width (1.7) and round caps, so
 * they read as one family — which is the only thing a set buys you.
 *
 * NO ICON IS A DECISION, NOT AN OMISSION. An item with no entry here
 * gets the dot, and the rail still lines up: a missing icon must never
 * shift the labels of the items below it.
 */

const S = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const PATHS: Record<string, JSX.Element> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  tasks: <><path d="M9 11l2 2 4-4" /><rect x="3" y="4" width="18" height="16" rx="2.5" /></>,
  scan: <><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M4 12h16" /></>,
  pipeline: <><path d="M3 5h18M6 12h12M10 19h4" /></>,
  customers: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 11a3 3 0 1 0 0-6" /><path d="M18 20c0-2.4-.9-4.2-2.3-5.3" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></>,
  whatsapp: <><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3.5 20.5l1.7-5A8.5 8.5 0 1 1 21 11.5Z" /></>,
  "company-profile": <><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
  quotations: <><path d="M14 3v5h5" /><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7Z" /><path d="M9 13h6M9 17h4" /></>,
  proformas: <><path d="M14 3v5h5" /><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7Z" /><path d="M9 14h6" /></>,
  prospects: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  campaigns: <><path d="M4 10v4a1 1 0 0 0 1 1h3l5 4V5L8 9H5a1 1 0 0 0-1 1Z" /><path d="M17.5 9a4 4 0 0 1 0 6" /></>,
  "purchase-orders": <><path d="M6 7h13l-1.3 8.2a2 2 0 0 1-2 1.7H9.3a2 2 0 0 1-2-1.7L6 4.5H3.5" /><circle cx="10" cy="20" r="1.2" /><circle cx="17" cy="20" r="1.2" /></>,
  orders: <><path d="M3.5 8.5 12 4l8.5 4.5v7L12 20l-8.5-4.5Z" /><path d="M3.5 8.5 12 13l8.5-4.5M12 13v7" /></>,
  dispatch: <><path d="M3 7h10v9H3z" /><path d="M13 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>,
  subscriptions: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v4h-4" /></>,
  renewals: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v4h-4" /><path d="M12 8v4l2.5 1.5" /></>,
  invoices: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6" /></>,
  receivables: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.6" /><path d="M6 12h.01M18 12h.01" /></>,
  "payment-tracker": <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /></>,
  reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  activity: <><path d="M3 12h4l2.5-6 4 13 2.5-7h5" /></>,
  assistant: <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 10a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1v.4" /><path d="M12 17h.01" /></>,
  incentives: <><path d="M8 4h8v4a4 4 0 0 1-8 0Z" /><path d="M8 5H5v1a3 3 0 0 0 3 3M16 5h3v1a3 3 0 0 1-3 3" /><path d="M12 12v4M9 20h6M10.5 16h3l.5 4h-4Z" /></>,
  catalog: <><rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  "price-book": <><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v18H6.5A1.5 1.5 0 0 1 5 19.5Z" /><path d="M5 17h14" /><path d="M9 8h6" /></>,
  "discount-approvals": <><path d="m8 14 8-8" /><circle cx="8.5" cy="7.5" r="1.6" /><circle cx="15.5" cy="15.5" r="1.6" /><path d="M3 12a9 9 0 0 1 9-9" /><path d="M21 12a9 9 0 0 1-9 9" /></>,
  team: <><circle cx="8" cy="9" r="3" /><circle cx="16.5" cy="9" r="2.4" /><path d="M2.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><path d="M15 14.2c2.6.2 4.5 2.1 4.5 4.8" /></>,
  companies: <><path d="M4 21V6l7-3v18" /><path d="M11 10h8a1 1 0 0 1 1 1v10" /><path d="M14 14h3M14 17.5h3M7 9h1M7 13h1M7 17h1" /></>,
  integrations: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /><path d="M11 7h4a2 2 0 0 1 2 2v4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" /></>,
  components: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17M3.5 12h17" /></>,
};

/** The fallback: a dot. Drawn on the same grid so a nav item without an
 *  icon of its own still lines up with the ones that have them. */
const DOT = <circle cx="12" cy="12" r="3" />;

export function NavIcon({ id }: { id: string }) {
  return <svg {...S}>{PATHS[id] ?? DOT}</svg>;
}
