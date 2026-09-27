import { Shell, PageHead, Panel, Pill, Bar } from "../shell";
import { LEADS, fmtDay, inrShort, stage, userById } from "../demo";

const Score = ({ n }: { n: number }) => (
  <span className="score">
    <span className="score-num">{n}</span>
    <span className="score-track"><span className={"score-fill" + (n >= 80 ? " is-hot" : n < 50 ? " is-cold" : "")} style={{ width: n + "%" }} /></span>
  </span>
);

export function Leads() {
  return (
    <Shell active="Leads" crumb={["Sell", "Leads"]}>
      <PageHead
        title="Leads"
        sub="148 total · 12 unactioned · 3 follow-ups overdue"
        actions={<><button className="fchip">Export</button><button className="fchip">Import</button><button className="quick-create">+ New lead</button></>}
      />
      <Bar>
        <input className="fsearch" placeholder="Search name, company, phone, email…" readOnly />
        <button className="fchip is-on">My leads</button>
        <button className="fchip">All open</button>
        <button className="fchip">Unactioned</button>
        <button className="fchip">Overdue follow-up</button>
        <button className="fchip">Source ▾</button>
        <button className="fchip">Stage ▾</button>
        <button className="fchip">Owner ▾</button>
        <span className="fspacer" />
        <button className="fchip">Saved view: Hot this week ▾</button>
      </Bar>

      <Panel pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Lead</th><th>Company</th><th>Stage</th><th>Score</th><th>Priority</th>
                <th>Source</th><th>Owner</th><th className="num">Value</th>
                <th>Last activity</th><th>Next follow-up</th><th>Created</th>
              </tr>
            </thead>
            <tbody>
              {LEADS.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="strong linkish">{l.name}</div>
                    <div className="muted" style={{ fontSize: "var(--t-small)" }}>{l.title} · {l.phone}</div>
                  </td>
                  <td>{l.company}</td>
                  <td><Pill tone={stage(l.stage).tone}>{stage(l.stage).label}</Pill></td>
                  <td><Score n={l.score} /></td>
                  <td><Pill tone={l.priority === "High" ? "bad" : l.priority === "Medium" ? "warn" : "neutral"}>{l.priority}</Pill></td>
                  <td>{l.source}</td>
                  <td><span className="person"><span className="avatar">{userById(l.ownerId).initials}</span>{userById(l.ownerId).name.split(" ")[0]}</span></td>
                  <td className="num strong">{inrShort(l.value)}</td>
                  <td className="mono">{fmtDay(l.lastActivity)}</td>
                  <td className="mono">
                    {l.overdue ? <span style={{ color: "var(--bad)", fontWeight: 600 }}>{fmtDay(l.nextFollowUp)} ⚠</span> : fmtDay(l.nextFollowUp)}
                  </td>
                  <td className="mono muted">{fmtDay(l.created)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Shell>
  );
}
