import { Pill } from "../shell";
import { DEMO_BANNER, LEADS, TASKS, fmtDay, inrShort, stage, userById } from "../demo";

/** The phone view. It is NOT the desktop CRM shrunk: on a phone the job is
 *  the day's calls and follow-ups, so that is the whole of the first
 *  screen, and everything else is behind the tab bar. */
export function Mobile() {
  const today = TASKS.filter((t) => t.state === "today" || t.state === "overdue");
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", paddingBottom: 72 }}>
      <div className="topbar" style={{ padding: "0 var(--gap-wide)" }}>
        <span className="brand-mark">TZ</span>
        <span className="brand-name" style={{ fontSize: "var(--t-body)" }}>TechZoid CRM</span>
        <div className="topbar-right">
          <button className="topbar-icon" aria-label="Notifications"><span className="bell-dot" />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
          </button>
          <span className="who-mark who-mark-sm">PS</span>
        </div>
      </div>
      <div className="demo-banner" style={{ padding: "6px var(--gap-wide)" }}>{DEMO_BANNER}</div>

      <div style={{ padding: "var(--gap-wide)" }}>
        <div style={{ fontSize: "var(--t-page)", fontWeight: 650, color: "var(--ink)" }}>Today</div>
        <div style={{ fontSize: "var(--t-small)", color: "var(--ink-3)", marginTop: 2 }}>Friday, 27 September · 3 overdue, 3 due</div>

        <div className="kgrid" style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--gap)", margin: "var(--gap-wide) 0" }}>
          <div className="ktile"><div className="ktile-label">Overdue</div><div className="ktile-value is-bad">3</div></div>
          <div className="ktile"><div className="ktile-label">Due today</div><div className="ktile-value">3</div></div>
        </div>

        <div className="panel" style={{ marginBottom: "var(--gap-wide)" }}>
          <div className="panel-head"><h2 className="panel-title">Calls & follow-ups</h2></div>
          <div className="panel-body" style={{ padding: 0 }}>
            {today.map((t) => (
              <div key={t.id} style={{ padding: "var(--gap) var(--gap-wide)", borderBottom: "1px solid var(--rule)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: "var(--t-body)" }}>{t.title}</div>
                    <div style={{ fontSize: "var(--t-small)", color: "var(--ink-4)", marginTop: 2 }}>{t.related}</div>
                  </div>
                  <Pill tone={t.state === "overdue" ? "bad" : "accent"}>{fmtDay(t.due)}</Pill>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="fchip" style={{ flex: 1 }}>Call</button>
                  <button className="fchip" style={{ flex: 1 }}>Log outcome</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h2 className="panel-title">My hot leads</h2></div>
          <div className="panel-body" style={{ padding: 0 }}>
            {LEADS.slice(0, 4).map((l) => (
              <div key={l.id} style={{ padding: "var(--gap) var(--gap-wide)", borderBottom: "1px solid var(--rule)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: "var(--ink)", fontSize: "var(--t-body)" }}>{l.name}</div>
                    <div style={{ fontSize: "var(--t-small)", color: "var(--ink-4)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.company}</div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div style={{ fontWeight: 700, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{inrShort(l.value)}</div>
                    <div style={{ marginTop: 4 }}><Pill tone={stage(l.stage).tone}>{stage(l.stage).label}</Pill></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <nav className="mtabs">
        {["Today", "Leads", "Pipeline", "Accounts", "More"].map((t, i) => (
          <button className={"mtab" + (i === 0 ? " is-on" : "")} key={t}><span className="mtab-dot" />{t}</button>
        ))}
      </nav>
    </div>
  );
}
