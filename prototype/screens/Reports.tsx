import { Shell, PageHead, Panel, Pill, Bar } from "../shell";
import { TrendChart, FunnelChart, BarList } from "../charts";
import { FUNNEL, REVENUE_TREND, SOURCE_PERF, inrShort } from "../demo";

const LIBRARY = [
  { name: "Sales summary", desc: "Won, lost and open by period", owner: "Standard", run: "Today 08:10" },
  { name: "Lead report", desc: "Volume, source and status", owner: "Standard", run: "Today 08:10" },
  { name: "Conversion report", desc: "Stage-to-stage conversion and drop-off", owner: "Standard", run: "Yesterday" },
  { name: "Employee performance", desc: "Activity and revenue per salesperson", owner: "Standard", run: "Today 08:10" },
  { name: "Revenue report", desc: "By salesperson, product and account", owner: "Standard", run: "Today 08:10" },
  { name: "Pipeline report", desc: "Open pipeline by stage and close date", owner: "Standard", run: "Today 08:10" },
  { name: "Follow-up compliance", desc: "Kept, late and missed follow-ups", owner: "Custom · Abhinav", run: "26 Sept" },
  { name: "Lost opportunity analysis", desc: "Reasons, competitors and value", owner: "Custom · Abhinav", run: "26 Sept" },
  { name: "Lead source ROI", desc: "Cost, volume and revenue by source", owner: "Custom · Priyanshi", run: "24 Sept" },
];

export function Reports() {
  return (
    <Shell active="Reports" crumb={["Insight", "Reports"]}>
      <PageHead title="Reports & analytics" sub="9 reports · 3 scheduled to email weekly"
        actions={<><button className="fchip">Export all (XLSX)</button><button className="fchip">Schedule</button><button className="quick-create">+ New report</button></>} />
      <Bar>
        <button className="fchip is-on">Q2 FY 2026-27</button>
        <button className="fchip">Month</button><button className="fchip">Quarter</button><button className="fchip">Year</button>
        <button className="fchip">Team ▾</button><button className="fchip">Product ▾</button><button className="fchip">Source ▾</button>
        <span className="fspacer" />
        <button className="fchip">Export PDF</button><button className="fchip">Export CSV</button>
      </Bar>

      <div className="cols cols-main" style={{ marginBottom: "var(--gap-wide)" }}>
        <Panel title="Revenue trend against target"><TrendChart data={REVENUE_TREND} /></Panel>
        <Panel title="Conversion by stage"><FunnelChart data={FUNNEL} /></Panel>
      </div>

      <div className="cols cols-2" style={{ marginBottom: "var(--gap-wide)" }}>
        <Panel title="Lead source — volume against revenue" pad={false}>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Source</th><th className="num">Leads</th><th className="num">Won</th><th className="num">Conversion</th><th className="num">Revenue</th><th className="num">Revenue / lead</th></tr></thead>
              <tbody>
                {SOURCE_PERF.map((s) => (
                  <tr key={s.source}>
                    <td className="strong">{s.source}</td>
                    <td className="num">{s.leads}</td><td className="num">{s.won}</td>
                    <td className="num">{Math.round((s.won / s.leads) * 100)}%</td>
                    <td className="num strong">{inrShort(s.revenue)}</td>
                    <td className="num">{inrShort(s.revenue / s.leads)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Pipeline by expected close">
          <BarList data={[
            { label: "Oct 2026", value: 5100000 }, { label: "Nov 2026", value: 3950000 },
            { label: "Dec 2026", value: 4150000 }, { label: "Jan 2027", value: 2840000 },
          ]} format={inrShort} />
        </Panel>
      </div>

      <Panel title="Report library" pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Report</th><th>What it shows</th><th>Type</th><th>Last run</th><th>Export</th></tr></thead>
            <tbody>
              {LIBRARY.map((r) => (
                <tr key={r.name}>
                  <td className="strong linkish">{r.name}</td>
                  <td>{r.desc}</td>
                  <td><Pill tone={r.owner === "Standard" ? "neutral" : "accent"}>{r.owner}</Pill></td>
                  <td className="mono muted">{r.run}</td>
                  <td><span className="linkish" style={{ fontSize: "var(--t-small)" }}>XLSX · CSV · PDF</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Shell>
  );
}
