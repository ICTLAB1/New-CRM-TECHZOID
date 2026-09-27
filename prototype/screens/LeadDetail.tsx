import { Shell, Panel, Pill } from "../shell";
import { LEADS, LEAD_TIMELINE, OPPORTUNITIES, PIPELINE_STAGES, accountById, fmtDay, inr, inrShort, stage, userById } from "../demo";

const lead = LEADS[0]!;

function Path({ current }: { current: string }) {
  const at = PIPELINE_STAGES.findIndex((s) => s.id === current);
  return (
    <ol className="path" role="list">
      {PIPELINE_STAGES.map((s, i) => (
        <li key={s.id} className={"path-step " + (i < at ? "is-done" : i === at ? "is-current is-accent" : "is-todo")}>
          <span className="path-hit"><span className="path-tick">{i < at ? "✓" : ""}</span><span className="path-label">{s.label}</span></span>
        </li>
      ))}
    </ol>
  );
}

export function LeadDetail() {
  const owner = userById(lead.ownerId);
  const account = accountById(lead.accountId!);
  const related = OPPORTUNITIES.filter((o) => o.accountId === lead.accountId);
  return (
    <Shell active="Leads" crumb={["Sell", "Leads", lead.name]}>
      <header className="rec-head">
        <div className="rec-title">
          <span className="rec-mark">DR</span>
          <div>
            <h1 className="rec-name">{lead.name}</h1>
            <div className="rec-sub">
              <span>{lead.title} · {lead.company}</span>
              <span className="mono">{lead.id}</span>
              <span>Owner {owner.name}</span>
            </div>
          </div>
        </div>
        <div className="row-tight wrap" style={{ display: "flex", gap: 8 }}>
          <button className="fchip">Log a call</button>
          <button className="fchip">Send email</button>
          <button className="fchip">Schedule meeting</button>
          <button className="quick-create">Convert to opportunity</button>
        </div>
      </header>

      <div style={{ margin: "var(--gap-wide) 0" }}><Path current={lead.stage} /></div>

      <div className="rec-strip">
        <div className="rec-cell"><div className="rec-cell-l">Lead score</div><div className="rec-cell-v">{lead.score} / 100</div></div>
        <div className="rec-cell"><div className="rec-cell-l">Deal value</div><div className="rec-cell-v">{inrShort(lead.value)}</div></div>
        <div className="rec-cell"><div className="rec-cell-l">Priority</div><div className="rec-cell-v"><Pill tone="bad">{lead.priority}</Pill></div></div>
        <div className="rec-cell"><div className="rec-cell-l">Source</div><div className="rec-cell-v" style={{ fontSize: "var(--t-body)" }}>{lead.source}</div></div>
        <div className="rec-cell"><div className="rec-cell-l">Next follow-up</div><div className="rec-cell-v" style={{ fontSize: "var(--t-body)" }}>{fmtDay(lead.nextFollowUp)}</div></div>
        <div className="rec-cell"><div className="rec-cell-l">Last activity</div><div className="rec-cell-v" style={{ fontSize: "var(--t-body)" }}>{fmtDay(lead.lastActivity)}</div></div>
      </div>

      <div className="cols cols-record">
        <div className="stack">
          <Panel title="Lead details">
            <div className="fact"><div className="fact-l">Full name</div><div className="fact-v">{lead.name}</div></div>
            <div className="fact"><div className="fact-l">Title</div><div className="fact-v">{lead.title}</div></div>
            <div className="fact"><div className="fact-l">Email</div><div className="fact-v linkish">{lead.email}</div></div>
            <div className="fact"><div className="fact-l">Phone</div><div className="fact-v linkish">{lead.phone}</div></div>
            <div className="fact"><div className="fact-l">Status</div><div className="fact-v"><Pill tone={stage(lead.stage).tone}>{stage(lead.stage).label}</Pill></div></div>
            <div className="fact"><div className="fact-l">Created</div><div className="fact-v">{fmtDay(lead.created)}</div></div>
          </Panel>
          <Panel title="Company">
            <div className="fact"><div className="fact-l">Account</div><div className="fact-v linkish">{account.name}</div></div>
            <div className="fact"><div className="fact-l">Industry</div><div className="fact-v">{account.industry}</div></div>
            <div className="fact"><div className="fact-l">Account owner</div><div className="fact-v">{userById(account.ownerId).name}</div></div>
            <div className="fact"><div className="fact-l">Lifetime business</div><div className="fact-v">{inr(account.lifetime)}</div></div>
            <div className="fact"><div className="fact-l">Contacts on file</div><div className="fact-v">{account.contacts}</div></div>
          </Panel>
          <Panel title="Documents">
            <div className="fact"><div className="fact-l">TZ/QT/2026-27/0047</div><div className="fact-v">Quotation · {inrShort(4320000)} · Sent</div></div>
            <div className="fact"><div className="fact-l">Requirement note.pdf</div><div className="fact-v muted">Uploaded 22 Sept</div></div>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Log an activity">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "var(--gap)" }}>
              <button className="fchip is-on">Call</button><button className="fchip">Meeting</button>
              <button className="fchip">Email</button><button className="fchip">Note</button><button className="fchip">Task</button>
            </div>
            <div className="lf-label">What was said, and what you agreed</div>
            <input className="lf-input" placeholder="Outcome, requirement, objections…" readOnly />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--gap)", marginTop: "var(--gap)" }}>
              <div><div className="lf-label">Outcome</div><input className="lf-input" defaultValue="Interested" readOnly /></div>
              <div><div className="lf-label">Next follow-up</div><input className="lf-input" defaultValue="05 Oct 2026" readOnly /></div>
            </div>
            <div className="muted" style={{ fontSize: "var(--t-small)", marginTop: "var(--gap)" }}>
              Saving creates the next task automatically and updates the lead score.
            </div>
          </Panel>

          <Panel title="Activity timeline" pad={false}>
            <div className="panel-body">
              <ul className="tl">
                {LEAD_TIMELINE.map((e) => (
                  <li className="tl-item" key={e.id}>
                    <span className={"tl-pip is-" + (e.tone ?? "neutral")} />
                    <div className="tl-top">
                      <span className="tl-title">
                        {e.kind === "auto" ? <span className="tl-auto">Auto</span> : null} {e.title}
                      </span>
                      <span className="tl-time">{e.ts}</span>
                    </div>
                    {e.body ? <div className="tl-body">{e.body}</div> : null}
                    <div className="tl-by">{e.by}</div>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Open tasks">
            <div className="fact"><div className="fact-l">Call · due 28 Sept</div><div className="fact-v">Send revised pricing (3-year) <span className="tl-auto">Auto</span></div></div>
            <div className="fact"><div className="fact-l">Meeting · 29 Sept</div><div className="fact-v">Quarterly review</div></div>
          </Panel>
          <Panel title="Related opportunities">
            {related.map((o) => (
              <div className="fact" key={o.id}>
                <div className="fact-v linkish">{o.name}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 5 }}>
                  <Pill tone={stage(o.stage).tone}>{stage(o.stage).label}</Pill>
                  <span className="strong" style={{ fontVariantNumeric: "tabular-nums" }}>{inrShort(o.value)}</span>
                </div>
                <div className="fact-l" style={{ marginTop: 3 }}>Closes {fmtDay(o.close)}</div>
              </div>
            ))}
          </Panel>
          <Panel title="Automations watching this lead">
            <div className="fact"><div className="fact-v">Negotiation needs a weekly touch</div><div className="fact-l">Next fires 03 Oct</div></div>
            <div className="fact"><div className="fact-v">Score ≥ 80 → notify manager</div><div className="fact-l">Fired 15 Sept</div></div>
            <div className="fact"><div className="fact-v">No activity 14 days → re-engage</div><div className="fact-l">Armed</div></div>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
