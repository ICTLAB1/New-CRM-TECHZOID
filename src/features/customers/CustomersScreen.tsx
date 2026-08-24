import { useMemo, useState } from "react";
import { Presence } from "../../components/Presence";
import { PageHead } from "../../app/AppShell";
import { ShareLinkDialog } from "../leads/ShareLinkDialog";
import { Button, Card, Chip, Empty, Input, Select, Tabs } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { blankCustomer, customerLabel, type Customer } from "../../domain/customers/customer";
import { findDuplicate } from "../../domain/customers/duplicates";
import { cascadeReassign, type Workspace } from "../../domain/customers/cascade";
import { STAGES, stageOf } from "../../domain/pipeline/stages";
import { inrList } from "../../domain/currency/format";
import { fmtDate, isOverdue } from "../../domain/dates";
import { CustomerSheet } from "./CustomerSheet";
import { DuplicateWarning } from "./DuplicateWarning";

const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export interface CustomersScreenProps {
  customers: Customer[];
  workspace: Workspace;
  users: { id: string; name: string }[];
  customFields: { id: string; label: string }[];
  currentUser: { id: string; name: string; role: string };
  /** Read for `confirmBeforeSave` and passed to the sheet. */
  settings?: Record<string, unknown>;
  onChange: (customers: Customer[], workspace: Workspace) => void;
}

type Pending = { customer: Customer; duplicate: ReturnType<typeof findDuplicate<Customer>> };

export function CustomersScreen({ customers, workspace, users, customFields, currentUser, settings = {}, onChange }: CustomersScreenProps) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [owner, setOwner] = useState<string>("all");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [sharing, setSharing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);

  const canReassign = currentUser.role === "Admin" || currentUser.role === "Manager";
  const ownerName = (id: string): string => users.find((u) => u.id === id)?.name ?? "Unassigned";

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (stageFilter !== "all" && (c.stage ?? "lead") !== stageFilter) return false;
      if (owner !== "all" && c.ownerId !== owner) return false;
      if (!q) return true;
      return [c.company, c.contact, c.email, c.gstin, c.city].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [customers, query, stageFilter, owner]);

  /** Commit a save, cascading ownership if the owner changed. */
  const commit = (next: Customer) => {
    const previous = customers.find((c) => c.id === next.id);
    const reassigned = !!previous && previous.ownerId !== next.ownerId;

    const list = previous
      ? customers.map((c) => (c.id === next.id ? next : c))
      : [next, ...customers];

    if (reassigned) {
      const { workspace: ws, moved } = cascadeReassign(workspace, next.id, next.ownerId);
      onChange(list, ws);
      toast(
        moved > 0
          ? `Reassigned to ${ownerName(next.ownerId)} — ${moved} related record${moved === 1 ? "" : "s"} moved with it.`
          : `Reassigned to ${ownerName(next.ownerId)}.`,
        "good",
      );
    } else {
      onChange(list, workspace);
      toast(previous ? "Customer updated." : "Customer added.", "good");
    }
    setEditing(null);
    setPending(null);
  };

  /** Save, checking for a duplicate first — but only on genuinely new records. */
  const save = (next: Customer) => {
    const isNew = !customers.some((c) => c.id === next.id);
    if (isNew) {
      const duplicate = findDuplicate(next, customers, next.id);
      if (duplicate) { setPending({ customer: next, duplicate }); return; }
    }
    commit(next);
  };

  return (
    <main className="page">
      <PageHead
        title="Customers"
        sub={`${customers.length} account${customers.length === 1 ? "" : "s"} in the CRM.`}
        actions={
          <>
            {/* Sharing a link beats typing a customer's GSTIN from a phone
                call, so it sits next to the manual route rather than being
                buried in a menu. */}
            <Button tone="default" onClick={() => setSharing(true)}>Share a registration link</Button>
            <Button tone="primary" onClick={() => setEditing(blankCustomer(currentUser.id, uid()))}>
              New customer
            </Button>
          </>
        }
      />

      <Card padded={false}>
        <div style={{ padding: "0 var(--gap-wide)" }}>
          <Tabs
            active={stageFilter}
            onChange={setStageFilter}
            tabs={[
              { id: "all", label: "All", count: customers.length },
              ...STAGES.map((s) => ({
                id: s.id,
                label: s.label,
                count: customers.filter((c) => (c.stage ?? "lead") === s.id).length,
              })),
            ]}
          />
        </div>

        <div className="row wrap" style={{ padding: "var(--gap) var(--gap-wide)" }}>
          <Input
            style={{ maxWidth: 280 }}
            placeholder="Search name, contact, email, GSTIN…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select style={{ maxWidth: 180 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">Any owner</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <span className="grow" />
          <span className="field-hint">{shown.length} shown</span>
        </div>

        {shown.length === 0 ? (
          <Empty
            title="Nothing matches"
            body={query ? `No customer matches “${query}”.` : "No customer sits in this stage yet."}
            action={query ? <Button tone="default" onClick={() => setQuery("")}>Clear the search</Button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 4 }} />
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Location</th>
                  <th>Stage</th>
                  <th>Owner</th>
                  <th>Follow-up</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const stage = stageOf(c.stage);
                  const overdue = isOverdue(c.nextFollowUp);
                  return (
                    <tr key={c.id} className={overdue ? "needs-warn" : undefined} onClick={() => setEditing(c)} style={{ cursor: "pointer" }}>
                      <td className="edge-cell" />
                      <td data-head className="strong">{customerLabel(c)}</td>
                      <td data-label="Contact">{c.contact || "—"}</td>
                      <td data-label="Location" className="muted">{[c.city, c.country].filter(Boolean).join(", ") || "—"}</td>
                      <td data-label="Stage"><Chip tone={stage.tone}>{stage.label}</Chip></td>
                      <td data-label="Owner">{ownerName(c.ownerId)}</td>
                      <td data-label="Follow-up" className={overdue ? "" : "muted"} style={overdue ? { color: "var(--warn)" } : undefined}>
                        {fmtDate(c.nextFollowUp)}
                      </td>
                      <td data-label="Value" className="num strong">{Number(c.value) > 0 ? inrList(c.value) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Presence value={editing}>
        {(record, open) => (
        <CustomerSheet
          open={open}
          customer={record}
          users={users}
          customFields={customFields}
          canReassign={canReassign}
          currentUser={currentUser}
          settings={settings}
          onSave={save}
          onClose={() => setEditing(null)}
        />
        )}
      </Presence>

      {pending?.duplicate ? (
        <DuplicateWarning
          company={customerLabel(pending.customer)}
          matchCompany={customerLabel(pending.duplicate.match)}
          matchOwner={ownerName(pending.duplicate.match.ownerId)}
          byGstin={pending.duplicate.byGstin}
          onEdit={() => setPending(null)}
          onContinue={() => commit(pending.customer)}
        />
      ) : null}
      <ShareLinkDialog open={sharing} user={currentUser} onClose={() => setSharing(false)} />
    </main>
  );
}
