import { useEffect, useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Input, Select, Tabs } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import type { Customer, CustomerNote } from "../../domain/customers/customer";
import { TODAY, addDays, fmtDate } from "../../domain/dates";
import { stageOf } from "../../domain/pipeline/stages";

/**
 * My tasks: every follow-up that is due, in one list, with a way to say
 * "done".
 *
 * A follow-up in this CRM is the customer's next follow-up date plus the
 * note that says what it is for — the automations write both (a quotation
 * that went out, an invoice gone overdue, a renewal coming up), and so does
 * anybody logging a call with a next action. Until now there was no single
 * place to work through them, and nothing to tick off: a date only ever
 * moved when somebody remembered to edit the customer.
 */

export interface TasksScreenProps {
  customers: Customer[];
  users: { id: string; name: string }[];
  currentUser: { id: string; name: string; role?: string };
  onChange: (next: Customer[]) => void;
  onOpenCustomer: (c: Customer) => void;
  /** Changes when "+ New → Task" is picked, to open the form. */
  startNew?: number;
}

type Bucket = "overdue" | "today" | "week" | "later";

const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: "Overdue", today: "Due today", week: "Next 7 days", later: "Later",
};

const uid = () => "note_" + Math.random().toString(36).slice(2, 10);

/** What the task is for: the newest note carrying a next action, else a
 *  sensible line from the stage. */
function taskText(c: Customer): string {
  const withAction = (c.notes ?? [])
    .filter((n) => (n.nextAction ?? "").trim())
    .sort((a, b) => b.ts - a.ts)[0];
  if (withAction?.nextAction) return withAction.nextAction;
  return `Follow up — ${stageOf(c.stage).label}`;
}

export function TasksScreen({ customers, users, currentUser, onChange, onOpenCustomer, startNew }: TasksScreenProps) {
  const toast = useToast();
  const canSeeAll = currentUser.role === "Admin" || currentUser.role === "Manager";
  const [who, setWho] = useState<string>(canSeeAll ? "all" : currentUser.id);
  const [tab, setTab] = useState<"open" | Bucket>("open");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ customerId: "", due: addDays(TODAY(), 1), text: "" });
  useEffect(() => { if (startNew) setAdding(true); }, [startNew]);
  const today = TODAY();
  const weekEnd = addDays(today, 7);
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "—";

  const rows = useMemo(() => customers
    .filter((c) => !!c.nextFollowUp)
    .filter((c) => who === "all" || c.ownerId === who)
    .map((c) => {
      const due = c.nextFollowUp as string;
      const bucket: Bucket = due < today ? "overdue" : due === today ? "today" : due <= weekEnd ? "week" : "later";
      return { c, due, bucket, text: taskText(c) };
    })
    .sort((a, b) => a.due.localeCompare(b.due)), [customers, who, today, weekEnd]);

  const counts = (b: Bucket) => rows.filter((r) => r.bucket === b).length;
  const shown = rows.filter((r) => (tab === "open" ? r.bucket !== "later" : r.bucket === tab));

  const update = (id: string, fn: (c: Customer) => Customer) =>
    onChange(customers.map((c) => (c.id === id ? { ...fn(c), updatedAt: Date.now() } : c)));

  const note = (text: string, extra: Partial<CustomerNote> = {}): CustomerNote => ({
    id: uid(), ts: Date.now(), user: currentUser.name, userId: currentUser.id, type: "Note", text, ...extra,
  });

  const done = (c: Customer, text: string) => {
    update(c.id, (x) => ({ ...x, nextFollowUp: "", notes: [note(`Done: ${text}`), ...(x.notes ?? [])] }));
    toast(`Marked done — ${c.company || "customer"}.`, "good");
  };
  const snooze = (c: Customer, days: number) => {
    const next = addDays(today, days);
    update(c.id, (x) => ({ ...x, nextFollowUp: next }));
    toast(`Moved to ${fmtDate(next)}.`, "info");
  };
  const add = () => {
    const c = customers.find((x) => x.id === draft.customerId);
    if (!c || !draft.text.trim()) { toast("Pick a customer and say what the task is.", "bad"); return; }
    update(c.id, (x) => ({
      ...x,
      nextFollowUp: !x.nextFollowUp || x.nextFollowUp < today || draft.due < x.nextFollowUp ? draft.due : x.nextFollowUp,
      notes: [note(draft.text.trim(), { nextAction: draft.text.trim() }), ...(x.notes ?? [])],
    }));
    setAdding(false);
    setDraft({ customerId: "", due: addDays(today, 1), text: "" });
    toast("Task added.", "good");
  };

  return (
    <main className="page">
      <PageHead
        title="Tasks"
        sub={`${counts("overdue")} overdue · ${counts("today")} due today · ${counts("week")} this week`}
        actions={<Button tone="primary" onClick={() => setAdding((a) => !a)}>{adding ? "Cancel" : "New task"}</Button>}
      />

      {adding ? (
        <Card title="New task">
          <div className="row wrap" style={{ gap: "var(--gap)" }}>
            <Select style={{ maxWidth: 260 }} value={draft.customerId} onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}>
              <option value="">Customer…</option>
              {[...customers].sort((a, b) => (a.company ?? "").localeCompare(b.company ?? "")).map((c) => (
                <option key={c.id} value={c.id}>{c.company || c.contact || "Untitled"}</option>
              ))}
            </Select>
            <Input type="date" style={{ maxWidth: 170 }} value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} />
            <Input className="grow" style={{ minWidth: 220 }} placeholder="What needs doing — call, send revised quote, collect payment…"
              value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
            <Button tone="primary" onClick={add}>Add</Button>
          </div>
        </Card>
      ) : null}

      <Card padded={false}>
        <div style={{ padding: "0 var(--gap-wide)" }}>
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "open", label: "To do", count: counts("overdue") + counts("today") + counts("week") },
              { id: "overdue", label: "Overdue", count: counts("overdue") },
              { id: "today", label: "Today", count: counts("today") },
              { id: "week", label: "Next 7 days", count: counts("week") },
              { id: "later", label: "Later", count: counts("later") },
            ]}
          />
        </div>
        {canSeeAll ? (
          <div className="row wrap" style={{ padding: "var(--gap) var(--gap-wide)" }}>
            <Select style={{ maxWidth: 220 }} value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">Everyone's tasks</option>
              <option value={currentUser.id}>My tasks</option>
              {users.filter((u) => u.id !== currentUser.id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </div>
        ) : null}

        {shown.length === 0 ? (
          <Empty title="Nothing due" body="Follow-ups appear here when a quotation goes out, an invoice falls overdue, a renewal comes up, or someone logs a next action." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Due</th><th>Task</th><th>Customer</th>{canSeeAll ? <th>Owner</th> : null}<th /></tr>
              </thead>
              <tbody>
                {shown.map(({ c, due, bucket, text }) => (
                  <tr key={c.id} className={bucket === "overdue" ? "needs-bad" : bucket === "today" ? "needs-warn" : ""}>
                    <td data-label="Due" className="edge-cell">
                      <Chip tone={bucket === "overdue" ? "bad" : bucket === "today" ? "warn" : "neutral"}>
                        {bucket === "overdue" || bucket === "today" ? BUCKET_LABEL[bucket] : fmtDate(due)}
                      </Chip>
                      {bucket === "overdue" ? <div className="muted" style={{ fontSize: "var(--t-small)" }}>{fmtDate(due)}</div> : null}
                    </td>
                    <td data-label="Task" style={{ maxWidth: 460 }}>{text}</td>
                    <td data-label="Customer">
                      <button type="button" className="link-btn" onClick={() => onOpenCustomer(c)}>{c.company || c.contact || "Untitled"}</button>
                      <div className="muted" style={{ fontSize: "var(--t-small)" }}>{[c.contact, c.phone].filter(Boolean).join(" · ")}</div>
                    </td>
                    {canSeeAll ? <td data-label="Owner">{name(c.ownerId)}</td> : null}
                    <td data-actions>
                      <span className="row-tight">
                        <Button size="sm" tone="primary" onClick={() => done(c, text)}>Done</Button>
                        <Button size="sm" tone="default" onClick={() => snooze(c, 1)}>Tomorrow</Button>
                        <Button size="sm" tone="quiet" onClick={() => snooze(c, 7)}>+1 week</Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
