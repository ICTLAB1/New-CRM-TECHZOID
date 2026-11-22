import { motion } from "motion/react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** The screen on show, so a page title can carry that screen's tile. */
const ViewLabel = createContext<string>("");
import { MOD_LABEL, useHotkeys } from "../components/hotkeys";
import { filterNav, firstMatch } from "./launcherSearch";
import { ShortcutsHelp } from "../components/ShortcutsHelp";
import { NAV } from "./nav";
import { NavIcon } from "./NavIcon";
import { COMPANY_LOCKUP_PATH } from "./brand";
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
  /** The header search. Passed in because it searches the workspace, which
   *  the shell knows nothing about. */
  search?: ReactNode;
  /** "+ New" in the header. Absent where nothing can be created. */
  onNew?: (kind: NewKind) => void;
  /** Live counts worth interrupting for, by screen id: tasks due, renewals
   *  coming up, invoices overdue. */
  badges?: Record<string, number>;
  children: ReactNode;
}

export type NewKind = "customer" | "quotation" | "proforma" | "invoice" | "purchase-order" | "task";
const NEW_ITEMS: { kind: NewKind; label: string }[] = [
  { kind: "customer", label: "Customer" },
  { kind: "quotation", label: "Quotation" },
  { kind: "proforma", label: "Proforma invoice" },
  { kind: "invoice", label: "Tax invoice" },
  { kind: "purchase-order", label: "Purchase order" },
  { kind: "task", label: "Task" },
];

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");

export function AppShell({ view, onNavigate, user, brand, onSignOut, banner, bell, companyPicker, search, onNew, badges = {}, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menu, setMenu] = useState<{ id: string; left: number } | null>(null);
  const openMenu = (id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setMenu((m) => (m?.id === id ? null : { id, left: Math.min(r.left, window.innerWidth - 270) }));
  };
  const [userOpen, setUserOpen] = useState(false);
  const section = NAV.find((s) => s.items.some((i) => i.id === view));

  /* The shortcuts that belong to the whole app rather than to one panel.
     The bare keys stay out of the way while anyone is typing — see
     `tagIsTyping`; the one carrying Ctrl/Cmd is honoured everywhere. */
  useHotkeys([
    /* THE LAUNCHER'S OWN KEY, and the reason it exists: the panel draws a
       ⌘K chip on its search box, and a chip for a key that opened nothing
       would be a lie on the first thing anybody opens. It is listed in
       SHORTCUTS beside the hook so the cheatsheet cannot drift from it. */
    { key: "k", mod: true, run: () => setMenuOpen(true) },
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

  const nav = NAV.map((sec) => ({ ...sec, items: sec.items.map((i) => ({ ...i, badge: badges[i.id] || undefined })) }));

  return (
    <div className="shell">
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* ── the left rail ──────────────────────────────────────────────
          NAVIGATION IS A COLUMN NOW, not a row of dropdown menus. The
          row fitted eight of thirty-two destinations and hid the rest
          two clicks deep behind a section name; a rail shows every one
          of them, grouped, in the order somebody works. It is hidden
          below 960px, where the bottom bar takes over — a 268px rail on
          a phone is the whole screen. */}
      <aside className="rail" aria-label="Sections">
        {/* THE LOCKUP IS BLACK ARTWORK AND THE RAIL IS NEAR-BLACK, so the
            brand block is a white panel. Inverting the supplied logo to
            sit on the dark was the alternative and is not ours to do:
            the pinwheel is blue and amber, and a recoloured mark is a
            company's identity redrawn by its own software.

            NO TEXT BESIDE IT. The lockup already carries the name and
            the strapline; setting them again next to it prints both
            twice, which is the same mistake public/brand/README.md
            records about the email header. */}
        <div className="rail-brand">
          <img
            className="rail-logo"
            src={brand?.logo || COMPANY_LOCKUP_PATH}
            alt={brand?.name || "TechZoid Technologies"}
          />
        </div>

        <nav className="rail-nav scroll" aria-label="Main">
          {nav.map((sec) => (
            <div key={sec.label} className="rail-group">
              <div className="rail-group-label">{sec.label}</div>
              {sec.items.filter((i) => i.id !== "components").map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="rail-item"
                  aria-current={item.id === view ? "page" : undefined}
                  onClick={() => go(item.id)}
                >
                  <NavIcon id={item.id} />
                  <span className="rail-label">{item.label}</span>
                  {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                  {item.id === view ? (
                    <motion.span
                      layoutId="rail-ink"
                      className="rail-ink"
                      transition={{ type: "spring", stiffness: 480, damping: 38, mass: 0.7 }}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* The warm glow at the foot of the rail. Decoration, and the one
            piece of it in the whole interface — it carries no meaning and
            is marked hidden so a screen reader never meets it. */}
        <div className="rail-glow" aria-hidden />
      </aside>

      <div className="shell-main">
      <header className="global-header">
        {/* The launcher stays, and on a phone it is the only way to the
            sections the bottom bar has no room for. On a desktop the
            rail has already shown them, so it steps back to a quiet
            square rather than the first thing on the bar. */}
        <button type="button" className="launcher-btn" aria-label="App launcher" title="App launcher"
          onClick={() => setMenuOpen(true)}>
          <span aria-hidden className="waffle">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>
        </button>
        {/* The phone's copy of the brand. The bar is white here, so the
            lockup needs no panel of its own. */}
        <span className="gh-brand mobile-brand">
          <img
            className="brand-logo"
            src={brand?.logo || COMPANY_LOCKUP_PATH}
            alt={brand?.name || "TechZoid Technologies"}
          />
        </span>
        <span className="grow gh-search-wrap">
          {search ?? <input className="topsearch" type="search" placeholder="Search…" aria-label="Search" />}
        </span>
        {onNew ? (
          <button type="button" className="btn btn-primary btn-sm gh-new" aria-haspopup="menu"
            onClick={(e) => openMenu("new", e.currentTarget)} aria-label="New">
            <span aria-hidden>+</span><span className="gh-new-label"> New ▾</span>
          </button>
        ) : null}
        {companyPicker}
        {bell}
        <button type="button" className="gh-icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts"
          onClick={() => setHelpOpen(true)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M9.6 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.9.6-.9 1.1v.5" strokeLinecap="round" />
            <path d="M12 17h.01" strokeLinecap="round" />
          </svg>
        </button>
        <span className="topbar-crumb" title={`Financial year ${fyLabel()}`}>FY {fyLabel()}</span>
        <span className="gh-user">
          {/* NAME AND ROLE BESIDE THE INITIALS on a wide screen. On a
              shared machine — which is most of them here — a circle with
              two letters in it is not an answer to "whose session is
              this?". It folds back to the circle alone under 1200px. */}
          <button type="button" className="who-btn" aria-label={`${user.name} — account`} title={`${user.name} · ${user.role}`}
            onClick={() => setUserOpen((o) => !o)}>
            <span className="who-mark" aria-hidden>{initials(user.name)}</span>
            <span className="who-words">
              <span className="who-btn-name">{user.name}</span>
              <span className="who-btn-role">{user.role}</span>
            </span>
            <span className="who-caret" aria-hidden>▾</span>
          </button>
          {userOpen ? (
            <div className="gh-user-menu" role="menu" onMouseLeave={() => setUserOpen(false)}>
              <div className="who-name">{user.name}</div>
              <div className="who-role">{user.role}</div>
              {onSignOut ? <Button tone="default" size="sm" onClick={onSignOut}>Sign out</Button> : null}
            </div>
          ) : null}
        </span>
      </header>

      {/* The horizontal tab bar that used to sit here is gone: the rail
          above is the navigation now. Keeping both would be the same
          thirty-two destinations offered twice, in two different
          orders, with two different ideas of which one you are on. */}

      {menu ? (
        <>
          <div className="menu-scrim" onClick={() => setMenu(null)} />
          <div className="app-more-menu" role="menu" style={{ left: menu.left }}>
            {menu.id === "new" ? (
              <>
                <div className="menu-head">Create</div>
                {NEW_ITEMS.map((n) => (
                  <button key={n.kind} type="button" role="menuitem" className="app-more-item"
                    onClick={() => { onNew?.(n.kind); setMenu(null); setMenuOpen(false); }}>
                    New {n.label.toLowerCase()}
                  </button>
                ))}
              </>
            ) : (
              <>
                <div className="menu-head">{menu.id}</div>
                {(nav.find((s) => s.label === menu.id)?.items ?? [])
                  .filter((i) => !DIRECT_TABS.includes(i.id) && i.id !== "components")
                  .map((i) => (
                    <button key={i.id} type="button" role="menuitem" className="app-more-item"
                      aria-current={i.id === view ? "page" : undefined}
                      onClick={() => { go(i.id); setMenu(null); }}>
                      <span className="row-tight"><span className="obj-tile" data-obj={objOf(i.id)} aria-hidden>{i.label.slice(0, 1)}</span>{i.label}</span>
                      {i.badge ? <span className="nav-badge">{i.badge}</span> : null}
                    </button>
                  ))}
              </>
            )}
          </div>
        </>
      ) : null}

      {menuOpen ? (
        <Launcher view={view} badges={badges} onGo={go} onClose={() => setMenuOpen(false)} />
      ) : null}

      {/* Phones: the five places people go most, under the thumb. Everything
          else is one tap away in the menu (the launcher). */}
      <nav className="bottom-nav" aria-label="Main">
        {BOTTOM_TABS.map(([id, label]) => (
          <button key={id} type="button" className="bottom-tab"
            aria-current={id === view ? "page" : undefined} onClick={() => go(id)}>
            {id === view ? <motion.span layoutId="bottom-tab-ink" className="bottom-tab-ink" transition={{ type: "spring", stiffness: 480, damping: 38, mass: 0.7 }} /> : null}
            <span className="bottom-glyph" aria-hidden><NavIcon id={id} /></span>
            <span>{label}</span>
            {badges[id] ? <span key={badges[id]} className="nav-badge bottom-badge">{badges[id]}</span> : null}
          </button>
        ))}
        <button type="button" className="bottom-tab" aria-current={!BOTTOM_TABS.some(([id]) => id === view) ? "page" : undefined}
          onClick={() => setMenuOpen(true)}>
          {!BOTTOM_TABS.some(([id]) => id === view) ? <motion.span layoutId="bottom-tab-ink" className="bottom-tab-ink" transition={{ type: "spring", stiffness: 480, damping: 38, mass: 0.7 }} /> : null}
          <span className="bottom-glyph" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </span>
          <span>Menu</span>
        </button>
      </nav>

      <div className="main">
        <ConnectionBanner />
        {banner}
        <ViewLabel.Provider value={current?.label ?? ""}>
          <div key={view} className="view" data-obj={objOf(view)}>{children}</div>
        </ViewLabel.Provider>
      </div>
      </div>
    </div>
  );
}

/* ── the app launcher ─────────────────────────────────────────────────
   Every destination in the product on one dark panel, searchable.

   DARK, AND THE ONLY DIALOG THAT IS. It is the one surface that is about
   the application rather than about the work: it belongs with the rail,
   not with the white cards the records live on, and on a phone it is the
   whole screen. Everything painted here uses --shell-ink, and
   design-rules.test.ts now checks that, because --ink on near-black is
   invisible and nobody notices a label that has quietly stopped being
   there.

   THE SEARCH IS REAL. The reference design draws a search field with a
   ⌘K chip on it; a field that did not filter, or a chip for a key that
   opened nothing, would be two lies on the first panel anybody opens.
   The key is bound in AppShell above and listed in SHORTCUTS beside the
   hook, so the cheatsheet cannot drift from what the app does. */

/** One icon per section heading, keyed by the section's own label. A
 *  section with no entry gets the dot NavIcon falls back to, which is
 *  how a new section in nav.ts fails: visibly, and without breaking the
 *  grid. */
const SECTION_ICON: Record<string, string> = {
  Sell: "pipeline",
  Find: "prospects",
  Buy: "purchase-orders",
  Deliver: "dispatch",
  "Get paid": "receivables",
  Collect: "payment-tracker",
  Understand: "reports",
  Administer: "settings",
};

/** The arcs in the corner of the launcher's header band — the reference
 *  design's one flourish. Drawn rather than filed, for the same reason
 *  the sign-in trail is: it follows --brand and weighs nothing. */
function Arcs() {
  return (
    <svg className="launcher-arcs" viewBox="0 0 280 170" aria-hidden="true" focusable="false">
      {/* Quarter circles sharing a centre on the panel's top-right corner,
          so they read as one sweep bleeding off the edge rather than as
          eight separate curves. The widest run past the band and are
          clipped by it, which is what makes it look like a corner of
          something larger. */}
      {Array.from({ length: 8 }, (_, i) => {
        const r = 46 + i * 20;
        return (
          <path key={i} d={`M${280 - r} 0 A ${r} ${r} 0 0 1 280 ${r}`}
            fill="none" stroke="var(--brand)" strokeWidth="1.3"
            opacity={(0.46 - i * 0.045).toFixed(3)} />
        );
      })}
    </svg>
  );
}

function Launcher({ view, badges, onGo, onClose }: {
  view: string;
  badges: Record<string, number>;
  onGo: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const box = useRef<HTMLInputElement>(null);

  /* Focus the box on open, so ⌘K then typing works without a click. */
  useEffect(() => { box.current?.focus(); }, []);

  const groups = useMemo(() => filterNav(q), [q]);
  const first = firstMatch(groups);

  return (
    <div className="launcher-scrim" onClick={onClose}>
      <div
        className="launcher" role="dialog" aria-modal="true" aria-label="App launcher"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
          /* Enter opens what the search is showing. Only from the box —
             pressing Enter on a focused row must activate that row, which
             is the button's own job. */
          if (e.key === "Enter" && first && e.target === box.current) {
            e.preventDefault();
            onGo(first);
          }
        }}
      >
        <div className="launcher-top">
          {/* Black artwork on a near-black panel gets the white ground it
              was drawn for, exactly as the rail and the sign-in do. */}
          <div className="launcher-logo">
            <img src={COMPANY_LOCKUP_PATH} alt="TechZoid Technologies" />
          </div>
          <button type="button" className="launcher-close" onClick={onClose} aria-label="Close the launcher">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
          <Arcs />
        </div>

        <h2 className="launcher-title">App Launcher</h2>
        <p className="launcher-sub">Access all your CRM modules, tools and business operations.</p>

        <div className="launcher-search">
          <span className="launcher-search-icon" aria-hidden="true"><NavIcon id="prospects" /></span>
          <input
            ref={box}
            type="text"
            className="launcher-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search apps, modules or features…"
            aria-label="Search apps, modules or features"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="launcher-kbd">{MOD_LABEL === "⌘" ? "⌘K" : "Ctrl K"}</kbd>
        </div>

        {groups.length ? (
          <div className="launcher-grid">
            {groups.map((sec) => (
              <section key={sec.label} className="launcher-group">
                <h3 className="launcher-group-head">
                  <span className="launcher-group-icon" aria-hidden="true">
                    <NavIcon id={SECTION_ICON[sec.label] ?? ""} />
                  </span>
                  {sec.label}
                </h3>
                <div className="launcher-rows">
                  {sec.items.map((i) => (
                    <button key={i.id} type="button" className="launcher-item"
                      aria-current={i.id === view ? "page" : undefined} onClick={() => onGo(i.id)}>
                      {/* THE SAME ICON AS THE RAIL. It used to be the
                          label's first letter in a coloured circle, which
                          gave Prospects, Pipeline, Proformas and Purchase
                          orders four identical "P"s — a picture that
                          carried no information and had to be read past. */}
                      <span className="obj-tile" data-obj={objOf(i.id)} aria-hidden="true"><NavIcon id={i.id} /></span>
                      <span className="launcher-label">{i.label}</span>
                      {badges[i.id] ? <span className="nav-badge">{badges[i.id]}</span> : null}
                      <svg className="launcher-chev" width="15" height="15" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <p className="launcher-empty">Nothing here is called “{q.trim()}”.</p>
        )}
      </div>
    </div>
  );
}

/** The bottom bar on a phone: [screen id, label]. The icon comes from
 *  NavIcon, keyed by the id, so the bar and the rail cannot drift apart —
 *  the glyphs here used to be the typographic characters ⌂ ✓ ▤ ◉, which
 *  rendered as four different weights and sat at four different heights
 *  depending on the phone's own font. */
const BOTTOM_TABS: [string, string][] = [
  ["dashboard", "Home"],
  ["tasks", "Tasks"],
  ["pipeline", "Pipeline"],
  ["customers", "Customers"],
];

/** Screens with a tab of their own; everything else sits in its section's
 *  dropdown (Sell ▾, Deliver ▾, …) and in the launcher. */
export const DIRECT_TABS = ["dashboard", "tasks"];

/** Which object colour a screen's title tile carries. */
export function objOf(view: string): number {
  if (["customers", "team", "companies", "prospects"].includes(view)) return 1;
  if (["pipeline", "campaigns", "leads"].includes(view)) return 2;
  if (["quotations", "proformas", "catalog"].includes(view)) return 3;
  if (["orders", "dispatch", "purchase-orders"].includes(view)) return 4;
  if (["invoices", "receivables", "incentives"].includes(view)) return 5;
  if (["dashboard", "reports", "activity", "assistant", "tasks"].includes(view)) return 6;
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
