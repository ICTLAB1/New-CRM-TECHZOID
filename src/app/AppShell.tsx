import { createContext, useContext, useState, type ReactNode } from "react";

/** The screen on show, so a page title can carry that screen's tile. */
const ViewLabel = createContext<string>("");
import { useHotkeys } from "../components/hotkeys";
import { ShortcutsHelp } from "../components/ShortcutsHelp";
import { NAV } from "./nav";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { Button } from "../components/primitives";
import { fyLabel } from "../domain/numbering/docNumber";

export interface AppShellProps {
  view: string;
  onNavigate: (id: string) => void;
  user: { name: string; role: string };
  /** The company's own branding, from settings. Absent until an admin has
   *  uploaded a logo, in which case the wordmark stands in. */
  brand?: { name?: string; logo?: string };
  /** Absent in the demo build, where there is nobody to sign out. */
  onSignOut?: () => void;
  /** A strip above the page for something that applies everywhere — a save
   *  that failed, a preview with no server behind it. */
  banner?: ReactNode;
  /** Rendered in the topbar. Passed in rather than built here so the shell
   *  stays free of any opinion about where notifications come from. */
  bell?: ReactNode;
  /** The company picker, when this CRM holds more than one business. Passed
   *  in for the same reason as the bell: the shell lays the bar out, it does
   *  not decide what a company is. */
  companyPicker?: ReactNode;
  children: ReactNode;
}

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

export function AppShell({ view, onNavigate, user, brand, onSignOut, banner, bell, companyPicker, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const section = NAV.find((s) => s.items.some((i) => i.id === view));

  /* The two shortcuts that belong to the whole app rather than to one panel.
     Both are bare keys, so they stay out of the way while anyone is typing —
     see `tagIsTyping`. */
  useHotkeys([
    /* No Shift requirement: on some layouts "?" is not a shifted key at all,
       and the character arriving is the signal regardless of how it was
       typed. */
    { key: "?", run: () => setHelpOpen(true) },
    /* "/" jumps to whatever this screen searches. Every list renders exactly
       one search box, so the first one on the page is the right one; if a
       screen has none, this does nothing rather than stealing the key. */
    {
      key: "/",
      run: () => {
        const box = document.querySelector<HTMLInputElement>('input[placeholder*="Search" i], input[type="search"]');
        box?.focus();
        box?.select();
      },
    },
  ]);
  const current = section?.items.find((i) => i.id === view);

  const go = (id: string) => {
    onNavigate(id);
    setMenuOpen(false);
  };

  const all = NAV.flatMap((sec) => sec.items.map((i) => ({ ...i, section: sec.label })));
  const tabs = PRIMARY_TABS.map((id) => all.find((i) => i.id === id)).filter(Boolean) as typeof all;
  /* A screen reached from the launcher or "More" gets a tab of its own for
     as long as it is open, the way a record opened from search does. */
  const extra = !PRIMARY_TABS.includes(view) && current ? [{ ...current, section: section?.label ?? "" }] : [];
  const moreItems = all.filter((i) => !PRIMARY_TABS.includes(i.id) && i.id !== "components");

  return (
    <div className="shell">
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      <header className="global-header">
        <button type="button" className="launcher-btn" aria-label="App launcher" title="App launcher"
          onClick={() => setMenuOpen(true)}>
          <span aria-hidden className="waffle">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
        </button>
        <span className="gh-brand">
          {brand?.logo ? (
            <img className="brand-logo" src={brand.logo} alt={brand.name || "Home"} />
          ) : (
            <>
              <span className="brand-mark" aria-hidden>TZ</span>
              <span className="brand-name">{brand?.name || "TechZoid"}</span>
            </>
          )}
        </span>
        <span className="grow gh-search-wrap">
          <input className="topsearch" type="search" placeholder="Search customers, quotations, orders…" aria-label="Search" />
        </span>
        {companyPicker}
        {bell}
        <span className="topbar-crumb" title={`Financial year ${fyLabel()}`}>FY {fyLabel()}</span>
        <span className="gh-user">
          <button type="button" className="who-mark" aria-label={`${user.name} — account`} title={`${user.name} · ${user.role}`}
            onClick={() => setUserOpen((o) => !o)}>{initials(user.name)}</button>
          {userOpen ? (
            <div className="gh-user-menu" role="menu" onMouseLeave={() => setUserOpen(false)}>
              <div className="who-name">{user.name}</div>
              <div className="who-role">{user.role}</div>
              {onSignOut ? <Button tone="default" size="sm" onClick={onSignOut}>Sign out</Button> : null}
            </div>
          ) : null}
        </span>
      </header>

      <nav className="app-nav" aria-label="Main">
        <span className="app-name">Sales</span>
        <div className="app-tabs scroll">
          {[...tabs, ...extra].map((item) => (
            <button key={item.id} type="button" className="app-tab"
              aria-current={item.id === view ? "page" : undefined} onClick={() => go(item.id)}>
              {item.label}
              {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
            </button>
          ))}
          <span className="app-more">
            <button type="button" className="app-tab" aria-haspopup="menu" aria-expanded={moreOpen}
              onClick={() => setMoreOpen((o) => !o)}>More ▾</button>
            {moreOpen ? (
              <div className="app-more-menu" role="menu" onMouseLeave={() => setMoreOpen(false)}>
                {moreItems.map((i) => (
                  <button key={i.id} type="button" role="menuitem" className="app-more-item"
                    onClick={() => { go(i.id); setMoreOpen(false); }}>
                    {i.label}<span className="muted">{i.section}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </span>
        </div>
      </nav>

      {menuOpen ? (
        <div className="launcher-scrim" onClick={() => setMenuOpen(false)}>
          <div className="launcher" role="dialog" aria-label="App launcher" onClick={(e) => e.stopPropagation()}>
            <div className="launcher-head">
              <h2 className="page-title">App Launcher</h2>
              <Button tone="quiet" size="sm" onClick={() => setMenuOpen(false)}>Close</Button>
            </div>
            <div className="launcher-grid">
              {NAV.filter((sec) => sec.items.some((i) => i.id !== "components")).map((sec) => (
                <div key={sec.label} className="launcher-group">
                  <div className="eyebrow">{sec.label}</div>
                  {sec.items.filter((i) => i.id !== "components").map((i) => (
                    <button key={i.id} type="button" className="launcher-item"
                      aria-current={i.id === view ? "page" : undefined} onClick={() => go(i.id)}>
                      <span className="obj-tile" data-obj={objOf(i.id)} aria-hidden>{i.label.slice(0, 1)}</span>
                      {i.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="main">
        <ConnectionBanner />
        {banner}
        <ViewLabel.Provider value={current?.label ?? ""}>
          <div key={view} className="view" data-obj={objOf(view)}>{children}</div>
        </ViewLabel.Provider>
      </div>
    </div>
  );
}

/** The tabs always on the bar — the rest are under "More" and the launcher. */
export const PRIMARY_TABS = [
  "dashboard", "pipeline", "customers", "quotations", "proformas",
  "orders", "invoices", "receivables", "renewals", "reports",
];

/** Which object colour a screen's title tile carries. */
export function objOf(view: string): number {
  if (["customers", "team", "companies", "prospects"].includes(view)) return 1;
  if (["pipeline", "campaigns", "leads"].includes(view)) return 2;
  if (["quotations", "proformas", "catalog"].includes(view)) return 3;
  if (["orders", "dispatch", "purchase-orders"].includes(view)) return 4;
  if (["invoices", "receivables", "incentives"].includes(view)) return 5;
  if (["dashboard", "reports", "activity", "assistant"].includes(view)) return 6;
  if (["subscriptions", "renewals"].includes(view)) return 7;
  return 8;
}

/** Page title, optional subtitle, and the actions for this screen. */
export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  const screen = useContext(ViewLabel);
  return (
    <div className="page-head">
      <div className="page-head-id">
        <span className="obj-tile obj-tile-lg" aria-hidden>{(screen || title).slice(0, 1)}</span>
        <span className="page-head-text">
        <span className="page-eyebrow">{screen && screen !== title ? screen : "TechZoid CRM"}</span>
        <h1 className="page-title">{title}</h1>
        {sub ? <div className="page-sub">{sub}</div> : null}
        </span>
      </div>
      {actions ? <div className="row-tight wrap">{actions}</div> : null}
    </div>
  );
}
