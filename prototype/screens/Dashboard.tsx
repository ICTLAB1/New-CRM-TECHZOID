import { Shell, PageHead, Tile, Panel, Pill } from "../shell";
import { TrendChart, FunnelChart, BarList, TargetMeter } from "../charts";
import { FUNNEL, OPPORTUNITIES, PIPELINE_STAGES, REVENUE_TREND, SOURCE_PERF, TASKS, fmtDay, inrShort, userById } from "../demo";

/* DERIVED, never typed in. A dashboard whose headline figure disagrees
   with the list underneath it is the fastest way to lose a reader — and
   the arithmetic is the one thing nobody checks twice. */
const OPEN = OPPORTUNITIES.filter((o) => o.stage !== "won" && o.stage !== "lost");
const OPEN_TOTAL = OPEN.reduce((n, o) => n + o.value, 0);
const WEIGHTED = OPEN.reduce((n, o) => n + o.value * (PIPELINE_STAGES.find((s) => s.id === o.stage)?.probability ?? 0) / 100, 0);

export function Dashboard() {
  const due = TASKS.filter((t) => t.state === "today");
  const overdue = TASKS.filter((t) => t.state === "overdue");
  return (
    <Shell active="Home" crumb={["Sell", "Home"]}>
      <PageHead
        title="Good morning, Priyanshi"
        sub="Friday, 27 September 2026 · Q2 FY 2026-27"
        actions={<><button className="fchip">This quarter ▾</button><button className="quick-create">+ Create</button></>}
      />

      <div className="kgrid" style={{ marginBottom: "var(--gap-wide)" }}>
        <Tile label="Total leads" value="148" meta="+12 this week" />
        <Tile label="New leads" value="12" meta="unactioned" tone="warn" />
        <Tile label="Qualified" value="96" meta="65% of total" />
        <Tile label="Open opportunities" value={String(OPEN.length)} meta="across 6 accounts" />
        <Tile label="Pipeline value" value={inrShort(OPEN_TOTAL)} meta={OPEN.length + " open, at full value"} />
        <Tile label="Won this quarter" value={inrShort(5850000)} meta="9 deals" tone="good" />
      </div>
      <div className="kgrid" style={{ marginBottom: "var(--gap-block)" }}>
        <Tile label="Lost this quarter" value={inrShort(1280000)} meta="4 deals" tone="bad" />
        <Tile label="Follow-ups due today" value={String(due.length)} meta="2 automated" />
        <Tile label="Overdue follow-ups" value={String(overdue.length)} meta="oldest 2 days" tone="bad" />
        <Tile label="Conversion rate" value="18.4%" meta="lead → won, 90 days" />
        <Tile label="Avg. deal size" value={inrShort(1780000)} meta="up 9% on last quarter" />
        <Tile label="Avg. sales cycle" value="34 days" meta="lead to close" />
      </div>

      <div className="cols cols-main" style={{ marginBottom: "var(--gap-wide)" }}>
        <Panel title="Revenue won against target">
          <TrendChart data={REVENUE_TREND} />
        </Panel>
        <Panel title="Sales target — this quarter">
          <TargetMeter achieved={5850000} target={9000000} label={inrShort(5850000) + " of " + inrShort(9000000)} />
          <div style={{ marginTop: "var(--gap-block)" }}>
            <div className="fact"><div className="fact-l">Committed (won)</div><div className="fact-v">{inrShort(5850000)}</div></div>
            <div className="fact"><div className="fact-l">Weighted pipeline</div><div className="fact-v">{inrShort(WEIGHTED)}</div></div>
            <div className="fact"><div className="fact-l">Best case (all open)</div><div className="fact-v">{inrShort(OPEN_TOTAL)}</div></div>
            <div className="fact"><div className="fact-l">Gap to target</div><div className="fact-v" style={{ color: "var(--warn)" }}>{inrShort(3150000)}</div></div>
          </div>
        </Panel>
      </div>

      <div className="cols cols-main" style={{ marginBottom: "var(--gap-wide)" }}>
        <Panel title="Pipeline funnel — where leads are falling out">
          <FunnelChart data={FUNNEL} />
        </Panel>
        <Panel title="Revenue by lead source">
          <BarList data={SOURCE_PERF.map((s) => ({ label: s.source, value: s.revenue }))} format={inrShort} />
        </Panel>
      </div>

      <Panel title="Today's activities" actions={<span className="muted" style={{ fontSize: "var(--t-small)" }}>{due.length + overdue.length} to clear</span>} pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Task</th><th>Type</th><th>Related to</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead>
            <tbody>
              {[...overdue, ...due].map((t) => (
                <tr key={t.id}>
                  <td className="strong">{t.title} {t.auto ? <span className="tl-auto">Auto</span> : null}</td>
                  <td>{t.type}</td>
                  <td>{t.related}</td>
                  <td><span className="person"><span className="avatar">{userById(t.ownerId).initials}</span>{userById(t.ownerId).name}</span></td>
                  <td className="mono">{fmtDay(t.due)}</td>
                  <td><Pill tone={t.priority === "High" ? "bad" : t.priority === "Medium" ? "warn" : "neutral"}>{t.priority}</Pill></td>
                  <td><Pill tone={t.state === "overdue" ? "bad" : "accent"}>{t.state === "overdue" ? "Overdue" : "Due today"}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Shell>
  );
}
