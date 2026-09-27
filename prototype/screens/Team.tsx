import { Shell, PageHead, Tile, Panel, Pill } from "../shell";
import { TargetMeter, MiniBars, BarList } from "../charts";
import { OPPORTUNITIES, PIPELINE_STAGES, TEAM_PERF, inrShort } from "../demo";

const OPEN = OPPORTUNITIES.filter((o) => o.stage !== "won" && o.stage !== "lost");
const OPEN_TOTAL = OPEN.reduce((n, o) => n + o.value, 0);
const WEIGHTED = OPEN.reduce((n, o) => n + o.value * (PIPELINE_STAGES.find((s) => s.id === o.stage)?.probability ?? 0) / 100, 0);

export function MyPerformance() {
  const me = TEAM_PERF[0]!;
  return (
    <Shell active="My performance" crumb={["Insight", "My performance"]}>
      <PageHead title="My performance" sub="Priyanshi Sharma · Sales Manager · Q2 FY 2026-27"
        actions={<button className="fchip">This quarter ▾</button>} />
      <div className="kgrid" style={{ marginBottom: "var(--gap-wide)" }}>
        <Tile label="Leads assigned" value={String(me.leads)} meta="8 unactioned" />
        <Tile label="Calls completed" value={String(me.calls)} meta="22 this week" />
        <Tile label="Meetings" value={String(me.meetings)} meta="3 this week" />
        <Tile label="Opportunities" value={String(me.opps)} meta={inrShort(9820000) + " open"} />
        <Tile label="Deals won" value={String(me.won)} meta={inrShort(me.revenue)} tone="good" />
        <Tile label="Pending activities" value={String(me.pending)} meta="1 overdue" tone="warn" />
      </div>
      <div className="cols cols-main" style={{ marginBottom: "var(--gap-wide)" }}>
        <Panel title="Target vs achievement">
          <TargetMeter achieved={me.revenue} target={me.target} label={inrShort(me.revenue) + " of " + inrShort(me.target)} />
          <div style={{ marginTop: "var(--gap-block)" }}>
            <div className="fact"><div className="fact-l">Conversion rate</div><div className="fact-v">21.4% — above team average of 18.4%</div></div>
            <div className="fact"><div className="fact-l">Average deal size</div><div className="fact-v">{inrShort(1470000)}</div></div>
            <div className="fact"><div className="fact-l">Average sales cycle</div><div className="fact-v">31 days</div></div>
            <div className="fact"><div className="fact-l">Follow-ups kept on time</div><div className="fact-v">92%</div></div>
          </div>
        </Panel>
        <Panel title="Activity, last 10 working days">
          <div className="fact"><div className="fact-l">Calls</div><div className="fact-v"><MiniBars values={[6, 9, 4, 11, 7, 8, 12, 5, 9, 7]} /></div></div>
          <div className="fact"><div className="fact-l">Meetings</div><div className="fact-v"><MiniBars values={[1, 2, 0, 2, 1, 1, 3, 0, 2, 2]} /></div></div>
          <div className="fact"><div className="fact-l">Emails logged</div><div className="fact-v"><MiniBars values={[12, 8, 14, 9, 11, 6, 15, 10, 13, 9]} /></div></div>
        </Panel>
      </div>
      <Panel title="My open pipeline by stage">
        <BarList data={[
          { label: "Negotiation", value: 5100000 }, { label: "Proposal Sent", value: 2100000 },
          { label: "Requirement", value: 1850000 }, { label: "Qualified", value: 770000 },
        ]} format={inrShort} />
      </Panel>
    </Shell>
  );
}

export function Management() {
  const ranked = [...TEAM_PERF].sort((a, b) => b.revenue - a.revenue);
  return (
    <Shell active="Management" crumb={["Insight", "Management"]}>
      <PageHead title="Management dashboard" sub="Whole business · Q2 FY 2026-27 · updated 2 minutes ago"
        actions={<><button className="fchip">Q2 FY 2026-27 ▾</button><button className="fchip">All teams ▾</button><button className="fchip">Export</button></>} />
      <div className="kgrid" style={{ marginBottom: "var(--gap-wide)" }}>
        <Tile label="Total sales (YTD)" value={inrShort(26650000)} meta="vs ₹21.4 Cr last year" tone="good" />
        <Tile label="This month" value={inrShort(5850000)} meta="130% of monthly target" tone="good" />
        <Tile label="Open pipeline" value={inrShort(OPEN_TOTAL)} meta={OPEN.length + " opportunities"} />
        <Tile label="Forecast (weighted)" value={inrShort(WEIGHTED)} meta="probability-adjusted" />
        <Tile label="Lost this quarter" value={inrShort(1280000)} meta="4 deals" tone="bad" />
        <Tile label="Outstanding follow-ups" value="3" meta="across 2 people" tone="warn" />
      </div>

      <div className="cols cols-main" style={{ marginBottom: "var(--gap-wide)" }}>
        <Panel title="Team performance" pad={false}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>#</th><th>Salesperson</th><th className="num">Leads</th><th className="num">Calls</th><th className="num">Meetings</th><th className="num">Opps</th><th className="num">Won</th><th className="num">Revenue</th><th className="num">Target</th><th>Achievement</th><th className="num">Conv.</th></tr></thead>
              <tbody>
                {ranked.map((u, i) => (
                  <tr key={u.id}>
                    <td className="strong">{i + 1}</td>
                    <td><span className="person"><span className="avatar">{u.initials}</span><span><span className="strong">{u.name}</span><br /><span className="muted" style={{ fontSize: "var(--t-small)" }}>{u.role}</span></span></span></td>
                    <td className="num">{u.leads}</td><td className="num">{u.calls}</td><td className="num">{u.meetings}</td>
                    <td className="num">{u.opps}</td><td className="num strong">{u.won}</td>
                    <td className="num strong">{inrShort(u.revenue)}</td>
                    <td className="num muted">{inrShort(u.target)}</td>
                    <td style={{ minWidth: 130 }}><TargetMeter achieved={u.revenue} target={u.target} /></td>
                    <td className="num">{Math.round((u.won / Math.max(u.opps, 1)) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Why we lost">
          <BarList data={[
            { label: "Price", value: 11 }, { label: "Competitor", value: 8 }, { label: "Budget issue", value: 6 },
            { label: "Timing", value: 4 }, { label: "Stopped responding", value: 3 },
          ]} />
          <div className="muted" style={{ fontSize: "var(--t-small)", marginTop: "var(--gap)" }}>
            Every lost deal requires a reason before it can be closed, so this chart has no “unknown” slice.
          </div>
        </Panel>
      </div>

      <div className="cols cols-3">
        <Panel title="Revenue by salesperson">
          <BarList data={ranked.map((u) => ({ label: u.name.split(" ")[0]!, value: u.revenue }))} format={inrShort} />
        </Panel>
        <Panel title="Revenue by product line">
          <BarList data={[
            { label: "Microsoft", value: 9800000 }, { label: "Hardware", value: 6400000 },
            { label: "Adobe", value: 3900000 }, { label: "Autodesk", value: 2600000 },
            { label: "Services", value: 1900000 },
          ]} format={inrShort} />
        </Panel>
        <Panel title="Lead source performance">
          <BarList data={[
            { label: "Referral", value: 5600000 }, { label: "IndiaMART", value: 4200000 },
            { label: "GeM Portal", value: 3800000 }, { label: "Website", value: 2100000 },
            { label: "Cold Outreach", value: 480000 },
          ]} format={inrShort} />
        </Panel>
      </div>
    </Shell>
  );
}
