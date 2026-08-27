import { useState, type ReactNode } from "react";
import { useHotkeys } from "../components/hotkeys";
import { ShortcutsHelp } from "../components/ShortcutsHelp";
import { NAV } from "./nav";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { Button } from "../components/primitives";

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
  children: ReactNode;
}

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

export function AppShell({ view, onNavigate, user, brand, onSignOut, banner, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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

  return (
    <div className="shell">
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      {menuOpen ? <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} /> : null}

      <aside className={"sidebar scroll" + (menuOpen ? " is-open" : "")}>
        <div className="sidebar-brand">
          {brand?.logo ? (
            <img className="brand-logo" src={brand.logo} alt={brand.name || "Home"} />
          ) : (
            <>
              <span className="brand-mark" aria-hidden>TZ</span>
              <span className="brand-name">{brand?.name || "TechZoid"}</span>
            </>
          )}
        </div>

        <nav className="nav">
          {NAV.map((section) => (
            <div key={section.label}>
              <div className="nav-section eyebrow">{section.label}</div>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="nav-item"
                  aria-current={item.id === view ? "page" : undefined}
                  onClick={() => go(item.id)}
                >
                  {item.label}
                  {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="who">
            <span className="who-mark" aria-hidden>{initials(user.name)}</span>
            <span className="grow">
              <span className="who-name" style={{ display: "block" }}>{user.name}</span>
              <span className="who-role">{user.role}</span>
            </span>
            {onSignOut ? (
              <Button tone="quiet" size="sm" onClick={onSignOut}>Sign out</Button>
            ) : null}
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Button className="mobile-only" tone="quiet" size="sm" iconOnly aria-label="Menu" onClick={() => setMenuOpen(true)}>☰</Button>
          <nav className="crumb truncate" aria-label="Breadcrumb">
            <span className="crumb-section">{section?.label ?? "TechZoid"}</span>
            <span className="crumb-sep" aria-hidden>/</span>
            <span className="crumb-current">{current?.label ?? "CRM"}</span>
          </nav>
          <span className="grow" />
          <input className="topsearch" type="search" placeholder="Search customers, quotations, orders…" aria-label="Search" />
          <span className="topbar-crumb">FY 2026-27</span>
        </header>
        {/* Connectivity first: when the network is gone it explains every
            other failure on the screen, so it belongs above them. */}
        <ConnectionBanner />
        {banner}
        {/* Keyed on the view so React replaces the subtree on navigation and
            the page's entrance animation re-runs. Without the key, moving
            between two screens that happen to share a root element would
            swap the content with no transition at all. */}
        <div key={view} className="view">{children}</div>
      </div>
    </div>
  );
}

/** Page title, optional subtitle, and the actions for this screen. */
export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub ? <div className="page-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="row-tight wrap">{actions}</div> : null}
    </div>
  );
}
