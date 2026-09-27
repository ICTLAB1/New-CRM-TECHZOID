import { Shell, PageHead, Panel, Pill, Bar } from "../shell";

const RULES = [
  { name: "Route new leads by source", trig: "A lead arrives", act: "Assign owner · Create first task · Notify", runs: 148, on: true },
  { name: "Score and prioritise on arrival", trig: "A lead arrives", act: "Calculate score · Set priority", runs: 148, on: true },
  { name: "Negotiation needs a weekly touch", trig: "A deal has not moved for 7 days", act: "Create call task · Notify owner", runs: 37, on: true },
  { name: "Proposal chase after 3 days", trig: "A deal moves to Proposal Sent", act: "Create call task (+3d)", runs: 27, on: true },
  { name: "Overdue follow-up escalates", trig: "A task is 2 days overdue", act: "Notify manager · Flag on dashboard", runs: 19, on: true },
  { name: "Invoice overdue at 15 days", trig: "An invoice is 15 days overdue", act: "Email customer · Notify owner", runs: 11, on: true },
  { name: "Dormant account re-engagement", trig: "No activity for 45 days", act: "Flag record · Create task · Notify", runs: 8, on: true },
  { name: "Lost deal requires a reason", trig: "A deal moves to Lost", act: "Require reason · Set re-engage date", runs: 14, on: true },
  { name: "Big deal alerts the director", trig: "A deal is created", act: "Notify · when value > ₹25,00,000", runs: 4, on: true },
  { name: "Won deal thanks the customer", trig: "A deal moves to Won", act: "Email customer", runs: 0, on: false },
];

export function Automations() {
  return (
    <Shell active="Automations" crumb={["Setup", "Automations"]}>
      <PageHead title="Automations" sub="10 rules · 9 running · 416 actions taken in the last 30 days"
        actions={<><button className="fchip">Activity log</button><button className="quick-create">+ New rule</button></>} />
      <Bar>
        <button className="fchip is-on">All</button><button className="fchip">Running</button>
        <button className="fchip">Paused</button><button className="fchip">Leads</button>
        <button className="fchip">Deals</button><button className="fchip">Invoices</button>
      </Bar>
      <Panel pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Rule</th><th>When</th><th>Then</th><th className="num">Fired (30d)</th><th>Status</th></tr></thead>
            <tbody>
              {RULES.map((r) => (
                <tr key={r.name}>
                  <td className="strong linkish">{r.name}</td>
                  <td>{r.trig}</td>
                  <td className="muted">{r.act}</td>
                  <td className="num">{r.runs || <span className="muted">—</span>}</td>
                  <td><Pill tone={r.on ? "good" : "neutral"}>{r.on ? "Running" : "Paused"}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="cols cols-2" style={{ marginTop: "var(--gap-wide)" }}>
        <Panel title="Rule editor — Negotiation needs a weekly touch">
          <div className="fact"><div className="fact-l">When</div><div className="fact-v">A deal has not moved for <span className="strong">7</span> days</div></div>
          <div className="fact"><div className="fact-l">And</div><div className="fact-v">Stage is Negotiation · Value is greater than ₹5,00,000</div></div>
          <div className="fact"><div className="fact-l">Then</div><div className="fact-v">Create a call task for the owner, due in 1 day</div></div>
          <div className="fact"><div className="fact-l">And</div><div className="fact-v">Notify the owner in the CRM</div></div>
          <div className="muted" style={{ fontSize: "var(--t-small)", marginTop: "var(--gap)" }}>
            A new rule starts paused. Nothing is sent to a customer until somebody switches it on.
          </div>
        </Panel>
        <Panel title="What fired today">
          <ul className="tl">
            <li className="tl-item"><span className="tl-pip is-accent" /><div className="tl-top"><span className="tl-title">Created 3 follow-up tasks</span><span className="tl-time">08:02</span></div><div className="tl-body">Negotiation needs a weekly touch · Meridian, Kestrel, Northgate</div></li>
            <li className="tl-item"><span className="tl-pip is-warn" /><div className="tl-top"><span className="tl-title">Escalated 2 overdue follow-ups</span><span className="tl-time">08:02</span></div><div className="tl-body">Overdue follow-up escalates · notified Abhinav Jain</div></li>
            <li className="tl-item"><span className="tl-pip is-accent" /><div className="tl-top"><span className="tl-title">Assigned 1 new lead</span><span className="tl-time">07:41</span></div><div className="tl-body">Route new leads by source · IndiaMART → Rashmi Nair</div></li>
          </ul>
        </Panel>
      </div>
    </Shell>
  );
}
