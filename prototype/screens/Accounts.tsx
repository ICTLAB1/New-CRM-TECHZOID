import { Shell, PageHead, Panel, Pill, Bar } from "../shell";
import { ACCOUNTS, fmtDay, inrShort, userById } from "../demo";

export function Accounts() {
  return (
    <Shell active="Accounts" crumb={["Sell", "Accounts"]}>
      <PageHead title="Accounts" sub="8 companies · 6 with open opportunities · 2 dormant"
        actions={<><button className="fchip">Export</button><button className="quick-create">+ New account</button></>} />
      <Bar>
        <input className="fsearch" placeholder="Search company, GSTIN, contact…" readOnly />
        <button className="fchip is-on">All accounts</button>
        <button className="fchip">My accounts</button>
        <button className="fchip">Dormant 60+ days</button>
        <button className="fchip">Industry ▾</button>
        <span className="fspacer" />
        <button className="fchip">Sort: Revenue potential ▾</button>
      </Bar>
      <Panel pad={false}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Company</th><th>Industry</th><th className="num">Contacts</th><th className="num">Open opps</th>
              <th className="num">Revenue potential</th><th className="num">Lifetime business</th>
              <th>Last interaction</th><th>Account owner</th><th>Status</th>
            </tr></thead>
            <tbody>
              {ACCOUNTS.map((a) => (
                <tr key={a.id}>
                  <td className="strong linkish">{a.name}</td>
                  <td>{a.industry}</td>
                  <td className="num">{a.contacts}</td>
                  <td className="num">{a.openOpps || <span className="muted">—</span>}</td>
                  <td className="num strong">{inrShort(a.potential)}</td>
                  <td className="num">{a.lifetime ? inrShort(a.lifetime) : <span className="muted">—</span>}</td>
                  <td className="mono">{fmtDay(a.lastInteraction)}</td>
                  <td><span className="person"><span className="avatar">{userById(a.ownerId).initials}</span>{userById(a.ownerId).name.split(" ")[0]}</span></td>
                  <td><Pill tone={a.status === "Active" ? "good" : a.status === "Prospect" ? "accent" : "warn"}>{a.status}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </Shell>
  );
}
