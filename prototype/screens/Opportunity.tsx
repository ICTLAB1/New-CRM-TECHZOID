import { Shell, Panel, Pill } from "../shell";
import { OPPORTUNITIES, PIPELINE_STAGES, accountById, fmtDay, inr, inrShort, stage, userById } from "../demo";

const opp = OPPORTUNITIES[0]!;

export function Opportunity() {
  const acct = accountById(opp.accountId);
  const owner = userById(opp.ownerId);
  const at = PIPELINE_STAGES.findIndex((s) => s.id === opp.stage);
  const prob = stage(opp.stage).probability;
  return (
    <Shell active="Opportunities" crumb={["Sell", "Opportunities", opp.id]}>
      <header className="rec-head">
        <div className="rec-title">
          <span className="rec-mark">OP</span>
          <div>
            <h1 className="rec-name">{opp.name}</h1>
            <div className="rec-sub">
              <span className="linkish">{acct.name}</span>
              <span className="mono">{opp.id}</span>
              <span>Owner {owner.name}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="fchip">Log a call</button>
          <button className="fchip">Create quotation</button>
          <button className="fchip">Mark lost</button>
          <button className="quick-create">Mark won</button>
        </div>
      </header>

      <div style={{ margin: "var(--gap-wide) 0" }}>
        <ol className="path" role="list">
          {PIPELINE_STAGES.map((s, i) => (
            <li key={s.id} className={"path-step " + (i < at ? "is-done" : i === at ? "is-current is-accent" : "is-todo")}>
              <span className="path-hit"><span className="path-tick">{i < at ? "✓" : ""}</span><span className="path-label">{s.label}</span></span>
            </li>
          ))}
        </ol>
      </div>

      <div className="rec-strip">
        <div className="rec-cell"><div className="rec-cell-l">Deal value</div><div className="rec-cell-v">{inr(opp.value)}</div></div>
        <div className="rec-cell"><div className="rec-cell-l">Probability</div><div className="rec-cell-v">{prob}%</div></div>
        <div className="rec-cell"><div className="rec-cell-l">Weighted</div><div className="rec-cell-v">{inrShort(opp.value * prob / 100)}</div></div>
        <div className="rec-cell"><div className="rec-cell-l">Expected close</div><div className="rec-cell-v" style={{ fontSize: "var(--t-body)" }}>{fmtDay(opp.close)}</div></div>
        <div className="rec-cell"><div className="rec-cell-l">Stage</div><div className="rec-cell-v"><Pill tone={stage(opp.stage).tone}>{stage(opp.stage).label}</Pill></div></div>
        <div className="rec-cell"><div className="rec-cell-l">Age</div><div className="rec-cell-v" style={{ fontSize: "var(--t-body)" }}>44 days</div></div>
      </div>

      <div className="cols cols-record">
        <div className="stack">
          <Panel title="Opportunity">
            <div className="fact"><div className="fact-l">Name</div><div className="fact-v">{opp.name}</div></div>
            <div className="fact"><div className="fact-l">Account</div><div className="fact-v linkish">{acct.name}</div></div>
            <div className="fact"><div className="fact-l">Primary contact</div><div className="fact-v">Devika Rao · Head of IT</div></div>
            <div className="fact"><div className="fact-l">Salesperson</div><div className="fact-v">{owner.name}</div></div>
            <div className="fact"><div className="fact-l">Source</div><div className="fact-v">Existing Client</div></div>
            <div className="fact"><div className="fact-l">Created</div><div className="fact-v">14 Aug 2026</div></div>
          </Panel>
          <Panel title="Next action">
            <div className="fact"><div className="fact-v">{opp.nextAction}</div><div className="fact-l" style={{ marginTop: 4 }}>Due 28 Sept · {owner.name} <span className="tl-auto">Auto</span></div></div>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Products & pricing" pad={false}>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Line total</th></tr></thead>
                <tbody>
                  {opp.products.map((p) => (
                    <tr key={p.name}><td className="strong">{p.name}</td><td className="num">{p.qty}</td><td className="num">{inr(p.unit)}</td><td className="num strong">{inr(p.qty * p.unit)}</td></tr>
                  ))}
                  <tr><td className="strong">Total</td><td /><td /><td className="num strong">{inr(opp.value)}</td></tr>
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Activity">
            <ul className="tl">
              <li className="tl-item"><span className="tl-pip is-accent" />
                <div className="tl-top"><span className="tl-title"><span className="tl-auto">Auto</span> Task created for next stage</span><span className="tl-time">26 Sept 16:40</span></div>
                <div className="tl-body">Moving to Negotiation created “Send revised pricing (3-year)”, due in 2 days.</div><div className="tl-by">System</div></li>
              <li className="tl-item"><span className="tl-pip is-good" />
                <div className="tl-top"><span className="tl-title">Call — 12 min</span><span className="tl-time">26 Sept 16:35</span></div>
                <div className="tl-body">Budget approved. Wants a 3-year commit quoted alongside annual.</div><div className="tl-by">Priyanshi Sharma</div></li>
              <li className="tl-item"><span className="tl-pip is-warn" />
                <div className="tl-top"><span className="tl-title">Stage — Proposal Sent → Negotiation</span><span className="tl-time">24 Sept 09:20</span></div>
                <div className="tl-by">Priyanshi Sharma</div></li>
              <li className="tl-item"><span className="tl-pip is-accent" />
                <div className="tl-top"><span className="tl-title">Quotation TZ/QT/2026-27/0047 sent</span><span className="tl-time">25 Sept 11:05</span></div>
                <div className="tl-body">{inr(4320000)} · emailed to devika.rao@meridianpharma.example</div><div className="tl-by">Priyanshi Sharma</div></li>
            </ul>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Forecast">
            <div className="fact"><div className="fact-l">Category</div><div className="fact-v">Commit</div></div>
            <div className="fact"><div className="fact-l">Weighted value</div><div className="fact-v">{inrShort(opp.value * prob / 100)}</div></div>
            <div className="fact"><div className="fact-l">Closes in</div><div className="fact-v">18 days</div></div>
          </Panel>
          <Panel title="Notes">
            <div className="fact"><div className="fact-v">Finance wants the 3-year option on a separate quote so both can go to the board together.</div><div className="fact-l" style={{ marginTop: 4 }}>Priyanshi Sharma · 26 Sept</div></div>
          </Panel>
          <Panel title="Competitors">
            <div className="fact"><div className="fact-v">Incumbent reseller quoting 4% lower</div><div className="fact-l">Flagged 22 Sept</div></div>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
