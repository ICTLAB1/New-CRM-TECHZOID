import { Shell, PageHead, Panel, Pill, Bar } from "../shell";
import { TASKS, fmtDay, userById } from "../demo";

const Group = ({ title, tone, rows }: { title: string; tone: string; rows: typeof TASKS }) => (
  <Panel title={title} actions={<Pill tone={tone}>{rows.length}</Pill>} pad={false}>
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Task</th><th>Type</th><th>Related to</th><th>Assigned to</th><th>Due</th><th>Priority</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td className="strong">{t.title} {t.auto ? <span className="tl-auto">Auto</span> : null}</td>
              <td>{t.type}</td>
              <td>{t.related}</td>
              <td><span className="person"><span className="avatar">{userById(t.ownerId).initials}</span>{userById(t.ownerId).name}</span></td>
              <td className="mono">{fmtDay(t.due)}</td>
              <td><Pill tone={t.priority === "High" ? "bad" : t.priority === "Medium" ? "warn" : "neutral"}>{t.priority}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Panel>
);

export function Tasks() {
  return (
    <Shell active="Tasks & Follow-ups" crumb={["Work", "Tasks & Follow-ups"]}>
      <PageHead title="Tasks & follow-ups" sub="10 open · 3 overdue · 6 created automatically"
        actions={<><button className="fchip">Calendar view</button><button className="quick-create">+ New task</button></>} />
      <Bar>
        <button className="fchip is-on">Mine</button>
        <button className="fchip">My team</button>
        <button className="fchip">Everyone</button>
        <button className="fchip">Calls</button>
        <button className="fchip">Meetings</button>
        <button className="fchip">Automated only</button>
        <span className="fspacer" />
        <input className="fsearch" placeholder="Search tasks…" readOnly />
      </Bar>
      <div className="stack">
        <Group title="Overdue" tone="bad" rows={TASKS.filter((t) => t.state === "overdue")} />
        <Group title="Due today" tone="accent" rows={TASKS.filter((t) => t.state === "today")} />
        <Group title="Upcoming" tone="neutral" rows={TASKS.filter((t) => t.state === "upcoming")} />
      </div>
    </Shell>
  );
}
