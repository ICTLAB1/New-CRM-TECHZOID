import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip, Empty, Input, Select } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import {
  addMember, addableTo, isLastAdmin, listMembers, removeMember, renameCompany, setMemberRole,
  type Company, type Member,
} from "../../data/companies";

/**
 * Who belongs to which company.
 *
 * WHY THIS PANEL HAD TO EXIST. Creating a company makes its creator the only
 * member, and every policy that governs membership asks whether you are
 * already privileged in that company — so without a screen, a second company
 * is a business one person can see and nobody else can be let into. The
 * database was ready for more than one company before there was any way to
 * staff one.
 *
 * ROLES ARE PER COMPANY, and that is the point rather than a detail. The
 * same person can be a director of one business and a salesperson in
 * another, and what they may do is decided by the company on screen, not by
 * a single role on their profile.
 *
 * THE LAST ADMIN CANNOT BE REMOVED OR DEMOTED. Not because it is untidy: a
 * company with no admin cannot be given one, since adding a member requires
 * being privileged in that company. The records stay, and become unreachable
 * through the CRM. The database refuses it (migration 034) and this disables
 * the control, so nobody has to discover the rule by tripping over it.
 */

const ROLES = ["Admin", "Manager", "Sales", "Accounts"];

const ROLE_NOTE: Record<string, string> = {
  Admin: "Everything, including who else is in this company.",
  Manager: "Sees the whole company's work; cannot manage members.",
  Sales: "Their own customers and documents only.",
  Accounts: "Their own work, for invoicing and receipts.",
};

export function CompaniesPanel({
  companies, activeId, everybody, onChanged,
}: {
  companies: Company[];
  activeId: string | null;
  /** Everybody with an account. Any signed-in person may read the profile
   *  list, which is what makes a picker possible at all. */
  everybody: { id: string; name: string; email?: string }[];
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState(activeId ?? companies[0]?.id ?? "");
  const company = companies.find((c) => c.id === selected);

  useEffect(() => {
    if (!companies.some((c) => c.id === selected)) setSelected(activeId ?? companies[0]?.id ?? "");
  }, [companies, selected, activeId]);

  if (!companies.length) {
    return (
      <Card title="Companies" padded>
        <Empty title="No companies yet" body="Ask an admin to add you to one." />
      </Card>
    );
  }

  return (
    <div className="stack">
      <Card title="Companies" padded={false}>
        <table className="table">
          <thead><tr><th>Company</th><th>Your role there</th><th /></tr></thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.name}
                  {c.id === activeId ? <> <Chip tone="accent" dot={false}>On screen</Chip></> : null}
                </td>
                <td>{c.role}</td>
                <td className="num">
                  <Button
                    tone={c.id === selected ? "primary" : "quiet"}
                    size="sm"
                    onClick={() => setSelected(c.id)}
                  >
                    {c.id === selected ? "Managing" : "Manage"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {company ? <CompanyDetail company={company} everybody={everybody} onChanged={onChanged} /> : null}
    </div>
  );
}

function CompanyDetail({
  company, everybody, onChanged,
}: {
  company: Company;
  everybody: { id: string; name: string; email?: string }[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState(company.name);
  const [busy, setBusy] = useState("");
  const [pick, setPick] = useState("");
  const [pickRole, setPickRole] = useState("Sales");

  const canManage = company.role === "Admin";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setMembers(await listMembers(company.id));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read who's in this company.");
    }
    setLoading(false);
  }, [company.id]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setName(company.name); }, [company.name]);

  const run = async (key: string, work: () => Promise<void>, done: string) => {
    setBusy(key);
    try {
      await work();
      await refresh();
      onChanged();
      toast(done, "good");
    } catch (err) {
      toast(err instanceof Error ? err.message : "That didn't work.", "bad");
    }
    setBusy("");
  };

  const candidates = addableTo(everybody, members);

  return (
    <div className="stack">
      <Card title={`${company.name} — its name`} padded>
        <div className="row-tight" style={{ alignItems: "flex-end", gap: 8 }}>
          <div style={{ flex: "1 1 320px", maxWidth: 420 }}>
            <label className="small muted" htmlFor="company-name">Registered name</label>
            <Input id="company-name" value={name} disabled={!canManage} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button
            tone="primary"
            loading={busy === "rename"}
            disabled={!canManage || !name.trim() || name.trim() === company.name}
            onClick={() => void run("rename", () => renameCompany(company.id, name), "Name saved")}
          >
            Save
          </Button>
        </div>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          This is the name in the company picker. What prints on quotations and invoices is set
          separately, in Settings → Company, once you switch to this company — along with its own
          GSTIN, logo and bank details.
        </p>
      </Card>

      <Card title="Who works in this company" padded={false}>
        {error ? <div className="notice notice-bad" style={{ margin: 12 }}><span>{error}</span></div> : null}
        {loading ? (
          <p className="muted" style={{ padding: 16, margin: 0 }}>Loading…</p>
        ) : (
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role here</th><th /></tr></thead>
            <tbody>
              {members.map((m) => {
                const last = isLastAdmin(members, m.userId);
                return (
                  <tr key={m.userId}>
                    <td>
                      {m.name}
                      {last ? <> <Chip tone="warn" dot={false}>Only admin</Chip></> : null}
                    </td>
                    <td className="mono">{m.email || "—"}</td>
                    <td style={{ width: 160 }}>
                      <Select
                        value={m.role}
                        aria-label={`Role for ${m.name}`}
                        disabled={!canManage || last || busy !== ""}
                        onChange={(e) => void run(
                          `role-${m.userId}`,
                          () => setMemberRole(company.id, m.userId, e.target.value),
                          `${m.name} is now ${e.target.value} here`,
                        )}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </Select>
                    </td>
                    <td className="num">
                      <Button
                        tone="danger"
                        size="sm"
                        loading={busy === `remove-${m.userId}`}
                        disabled={!canManage || last || busy !== ""}
                        title={last ? "Make somebody else an admin first." : undefined}
                        onClick={() => void run(
                          `remove-${m.userId}`,
                          () => removeMember(company.id, m.userId),
                          `${m.name} removed from ${company.name}`,
                        )}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {canManage ? (
          <div style={{ padding: 12, borderTop: "1px solid var(--rule, #e5e7eb)" }}>
            {candidates.length ? (
              <div className="row-tight" style={{ alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 240px", maxWidth: 320 }}>
                  <label className="small muted" htmlFor="add-member">Add someone</label>
                  <Select id="add-member" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">— choose a person —</option>
                    {candidates.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}{p.email ? ` — ${p.email}` : ""}</option>
                    ))}
                  </Select>
                </div>
                <div style={{ flex: "0 1 160px" }}>
                  <label className="small muted" htmlFor="add-role">As</label>
                  <Select id="add-role" value={pickRole} onChange={(e) => setPickRole(e.target.value)}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </div>
                <Button
                  tone="primary"
                  loading={busy === "add"}
                  disabled={!pick || busy !== ""}
                  onClick={() => void run(
                    "add",
                    async () => { await addMember(company.id, pick, pickRole); setPick(""); },
                    "Added to this company",
                  )}
                >
                  Add
                </Button>
              </div>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                Everybody with an account is already in this company. New people are given a sign-in
                under Team first, then added here.
              </p>
            )}
            <p className="muted small" style={{ margin: "8px 0 0" }}>
              {ROLE_NOTE[pickRole]} Removing somebody does not delete their work — their customers and
              documents stay with this company, and an admin here can still see them.
            </p>
          </div>
        ) : (
          <p className="muted small" style={{ padding: 12, margin: 0 }}>
            Only an admin of this company can change who works in it.
          </p>
        )}
      </Card>
    </div>
  );
}
