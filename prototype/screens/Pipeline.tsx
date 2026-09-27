import { Shell, PageHead, Pill, Bar } from "../shell";
import { OPPORTUNITIES, PIPELINE_STAGES, accountById, fmtDay, inrShort, userById, type Stage } from "../demo";

export function Pipeline() {
  const cols = PIPELINE_STAGES.map((s) => ({
    ...s,
    items: OPPORTUNITIES.filter((o) => o.stage === (s.id as Stage)),
  }));
  const total = OPPORTUNITIES.filter((o) => o.stage !== "won" && o.stage !== "lost").reduce((n, o) => n + o.value, 0);
  return (
    <Shell active="Pipeline" crumb={["Sell", "Pipeline"]}>
      <PageHead title="Sales pipeline" sub={`8 open opportunities · ${inrShort(total)} in play · drag a card to move a stage`}
        actions={<><button className="fchip">Board</button><button className="fchip">List</button><button className="quick-create">+ New opportunity</button></>} />
      <Bar>
        <button className="fchip is-on">All owners</button>
        <button className="fchip">My deals</button>
        <button className="fchip">Closing this quarter</button>
        <button className="fchip">Value &gt; ₹10L</button>
        <span className="fspacer" />
        <span className="muted" style={{ fontSize: "var(--t-small)" }}>Weighted: {inrShort(OPPORTUNITIES.filter((o) => o.stage !== "won" && o.stage !== "lost").reduce((n, o) => n + o.value * (PIPELINE_STAGES.find((s) => s.id === o.stage)?.probability ?? 0) / 100, 0))}</span>
      </Bar>

      <div className="kan">
        {cols.map((c) => (
          <div className="kan-col" key={c.id}>
            <div className="kan-head">
              <div className="kan-name">{c.label}</div>
              <div className="kan-sum">{c.items.length} · {inrShort(c.items.reduce((n, o) => n + o.value, 0))}</div>
            </div>
            <div className="kan-body">
              {c.items.map((o) => (
                <article className="kan-card" key={o.id}>
                  <div className="kan-card-name">{o.name}</div>
                  <div className="kan-card-acct">{accountById(o.accountId).name}</div>
                  <div className="kan-card-foot">
                    <span className="kan-card-val">{inrShort(o.value)}</span>
                    <span className="person"><span className="avatar">{userById(o.ownerId).initials}</span></span>
                  </div>
                  <div className="kan-card-foot">
                    <span className="muted" style={{ fontSize: "var(--t-small)" }}>Closes {fmtDay(o.close)}</span>
                    <Pill tone={c.tone}>{c.probability}%</Pill>
                  </div>
                </article>
              ))}
              {c.items.length === 0 ? <div className="muted" style={{ fontSize: "var(--t-small)", padding: "var(--gap)" }}>Nothing here</div> : null}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}
