import type { ReactNode } from "react";
import { DEMO_BANNER, USERS } from "./demo";

/**
 * The frame every screen sits in: left navigation, global search, quick
 * create, notifications, profile. One shell, so the screens read as one
 * product rather than eleven concepts.
 */

export const NAV = [
  { label: "Sell", items: ["Home", "Leads", "Accounts", "Contacts", "Opportunities", "Pipeline"] },
  { label: "Work", items: ["Tasks & Follow-ups", "Calendar", "Activities"] },
  { label: "Documents", items: ["Quotations", "Proformas", "Tax invoices", "Receivables"] },
  { label: "Insight", items: ["My performance", "Team", "Management", "Reports"] },
  { label: "Setup", items: ["Automations", "Products", "Users & roles", "Settings"] },
];

export function Shell({
  active, crumb, children, user = USERS[1]!, compact = false,
}: { active: string; crumb: string[]; children: ReactNode; user?: typeof USERS[number]; compact?: boolean }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">TZ</span>
          <span className="brand-name">TechZoid CRM</span>
        </div>
        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.label}>
              <div className="nav-section">{g.label}</div>
              {g.items.map((it) => (
                <button className="nav-item" key={it} aria-current={it === active ? "page" : undefined}>
                  <span className="nav-dot" aria-hidden="true" />
                  <span>{it}</span>
                  {it === "Tasks & Follow-ups" ? <span className="nav-badge">3</span> : null}
                  {it === "Leads" ? <span className="nav-badge">12</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <span className="who-mark">{user.initials}</span>
            <div><div className="who-name">{user.name}</div><div className="who-role">{user.role}</div></div>
          </div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="crumb">
            {crumb.map((c, i) => (
              <span key={c} style={{ display: "contents" }}>
                {i ? <span className="crumb-sep">/</span> : null}
                <span className={i === crumb.length - 1 ? "crumb-current" : "crumb-section"}>{c}</span>
              </span>
            ))}
          </div>
          <div className="topbar-right">
            <input className="topsearch" placeholder="Search leads, accounts, opportunities, people…" readOnly />
            <button className="quick-create">+ Create</button>
            <button className="topbar-icon" aria-label="Notifications">
              <span className="bell-dot" />
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
            </button>
            <span className="who-mark who-mark-sm">{user.initials}</span>
          </div>
        </div>
        <div className="demo-banner">{DEMO_BANNER}</div>
        <div className={compact ? "screen screen-compact" : "screen"}>{children}</div>
      </div>
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="ph">
      <div><h1 className="ph-title">{title}</h1>{sub ? <div className="ph-sub">{sub}</div> : null}</div>
      {actions ? <div className="row-tight wrap">{actions}</div> : null}
    </header>
  );
}

export function Tile({ label, value, meta, tone }: { label: string; value: string; meta?: string; tone?: string }) {
  return (
    <div className="ktile">
      <div className="ktile-label">{label}</div>
      <div className={"ktile-value" + (tone ? " is-" + tone : "")}>{value}</div>
      {meta ? <div className="ktile-meta">{meta}</div> : null}
    </div>
  );
}

export function Panel({ title, actions, children, pad = true }: { title?: string; actions?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="panel">
      {title ? <div className="panel-head"><h2 className="panel-title">{title}</h2>{actions}</div> : null}
      <div className={pad ? "panel-body" : ""}>{children}</div>
    </section>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: string; children: ReactNode }) {
  return <span className={"pill is-" + tone}><span className="pill-dot" />{children}</span>;
}

export function Bar({ children }: { children: ReactNode }) {
  return <div className="filterbar">{children}</div>;
}
