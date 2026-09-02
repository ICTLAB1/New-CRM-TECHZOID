import { useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Field, Input, Select } from "../../components/primitives";
import { Confirm, Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { BroadcastComposer } from "../broadcasts/BroadcastComposer";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";

/**
 * Team accounts.
 *
 * Everything destructive here goes through a Netlify function holding the
 * service-role key, because creating a sign-in, resetting a password and
 * removing an account are all things a browser must not be able to do on its
 * own. This screen only collects the details and reports what happened.
 */

export interface TeamMember {
  id: string;
  name: string;
  email?: string;
  role: string;
  /** Their own job title. Printed under their name on email they send to a
   *  customer — not the company's authorised signatory, which is one shared
   *  value in Settings and prints on the document itself. */
  designation?: string;
  /** Their own mobile, printed the same way. A customer replying to a
   *  quotation is trying to reach a person, not the switchboard. */
  phone?: string;
}

export interface TeamScreenProps {
  api: IntegrationsApi;
  members: TeamMember[];
  currentUser: { id: string; role: string };
  onChange: (next: TeamMember[]) => void;
}

const ROLES = ["Admin", "Manager", "Sales", "Accounts"] as const;

const ROLE_NOTE: Record<string, string> = {
  Admin: "Everything, including team accounts and settings.",
  Manager: "Sees the whole team's pipeline. Cannot manage accounts.",
  Sales: "Sees and edits only their own customers and documents.",
  Accounts: "Sees everything, for invoicing and collections.",
};

export function TeamScreen({ api, members, currentUser, onChange }: TeamScreenProps) {
  const toast = useToast();
  const isAdmin = currentUser.role === "Admin";
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [resetting, setResetting] = useState<TeamMember | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TeamMember | null>(null);
  const [error, setError] = useState("");

  const admins = members.filter((m) => m.role === "Admin").length;

  const changeRole = (member: TeamMember, role: string) => {
    /* The role lives in `profiles`, which RLS lets an admin update directly —
       no function needed. The policy is what actually enforces this; the
       check here only keeps the screen honest. */
    onChange(members.map((m) => (m.id === member.id ? { ...m, role } : m)));
    toast(`${member.name} is now ${role}`, "good");
  };

  const remove = async (member: TeamMember) => {
    setConfirmDelete(null);
    setError("");
    try {
      await api.deleteTeamMember(member.id);
      onChange(members.filter((m) => m.id !== member.id));
      toast(`${member.name}'s account was removed`, "good");
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't remove that account.");
    }
  };

  return (
    <main className="page">
      <PageHead
        title="Team"
        sub={isAdmin
          ? "Who can sign in, and what each person can see."
          : "Who is on the team. Only an admin can change accounts."}
        actions={isAdmin ? <Button tone="primary" onClick={() => setAdding(true)}>Add someone</Button> : null}
      />

      {error ? <div className="notice notice-bad" style={{ marginBottom: 12 }}><span>{error}</span></div> : null}

      {/* Putting a message on everybody's screen belongs beside the list of
          who would receive it. Row-level security is what actually enforces
          who may send — hiding the card is only tidiness. */}
      {currentUser.role === "Admin" || currentUser.role === "Manager" ? (
        <div style={{ marginBottom: 16 }}>
          <BroadcastComposer
            currentUser={currentUser}
            users={members.map((m) => ({ id: m.id, name: m.name }))}
          />
        </div>
      ) : null}

      <div className="stack">
      <Card padded={false}>
        {members.length === 0 ? (
          <div className="card-pad"><Empty title="Nobody yet" body="Add the first account." /></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Designation</th><th>Email</th><th>Mobile</th><th>Role</th><th /></tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      {m.id === currentUser.id ? <> <Chip tone="accent" dot={false}>You</Chip></> : null}
                    </td>
                    <td data-label="Designation">{m.designation || <span className="muted">—</span>}</td>
                    <td data-label="Email" className="mono">{m.email || "—"}</td>
                    <td data-label="Mobile" className="mono">{m.phone || <span className="muted">—</span>}</td>
                    <td>
                      {isAdmin ? (
                        <Select
                          value={m.role}
                          aria-label={`Role for ${m.name}`}
                          onChange={(e) => changeRole(m, e.target.value)}
                          /* Demoting the last admin locks everyone out of this
                             very screen. The server refuses the equivalent
                             deletion; refusing it here saves the round trip. */
                          disabled={m.role === "Admin" && admins <= 1}
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </Select>
                      ) : m.role}
                    </td>
                    <td>
                      {isAdmin ? (
                        <span className="row-tight">
                          <Button size="sm" tone="quiet" onClick={() => setEditing(m)}>Edit</Button>
                          <Button size="sm" tone="quiet" onClick={() => setResetting(m)}>Reset password</Button>
                          {m.id !== currentUser.id ? (
                            <Button size="sm" tone="danger" onClick={() => setConfirmDelete(m)}>Remove</Button>
                          ) : null}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="What each role sees">
        <div className="stack" style={{ gap: 6 }}>
          {ROLES.map((r) => (
            <div className="spread wrap" key={r} style={{ gap: 10 }}>
              <strong style={{ minWidth: 80 }}>{r}</strong>
              <span className="muted" style={{ flex: 1 }}>{ROLE_NOTE[r]}</span>
            </div>
          ))}
        </div>
        <div className="field-hint" style={{ marginTop: 10 }}>
          These are enforced by the database, not by the screen. A Sales user's queries never return another
          salesperson's rows, whatever the interface shows.
        </div>
      </Card>
      </div>

      {adding ? (
        <AddMember
          api={api}
          onClose={() => setAdding(false)}
          onAdded={(member) => { onChange([...members, member]); setAdding(false); }}
        />
      ) : null}

      {editing ? (
        <EditMember
          api={api}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={(patch) => {
            onChange(members.map((m) => (m.id === editing.id ? { ...m, ...patch } : m)));
            setEditing(null);
          }}
        />
      ) : null}

      {resetting ? (
        <ResetPassword api={api} member={resetting} onClose={() => setResetting(null)} />
      ) : null}

      <Confirm
        open={!!confirmDelete}
        title="Remove this account?"
        body={<>
          <strong>{confirmDelete?.name}</strong> will no longer be able to sign in. Their customers,
          quotations and orders stay where they are — reassign them first if someone else should pick them up.
        </>}
        confirmLabel="Remove the account"
        tone="danger"
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </main>
  );
}

/* ── adding ────────────────────────────────────────────────────────── */

function AddMember({
  api, onAdded, onClose,
}: { api: IntegrationsApi; onAdded: (m: TeamMember) => void; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [designation, setDesignation] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("Sales");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /* Shown when the account was created but the welcome email wasn't sent.
     Deliberately not an error: the account is real, and the admin needs to
     know to pass the password on themselves. */
  const [emailProblem, setEmailProblem] = useState<{ name: string; password: string; reason: string } | null>(null);

  const create = async () => {
    setError(""); setBusy(true);
    try {
      const result = await api.createTeamMember({
        name: name.trim(), email: email.trim().toLowerCase(), designation: designation.trim(),
        phone: phone.trim(), password, role,
      });
      onAdded({
        id: result.userId,
        name: name.trim() || email.split("@")[0] || "New member",
        email: email.trim().toLowerCase(),
        designation: designation.trim(),
        phone: phone.trim(),
        role,
      });
      if (result.emailSent) {
        toast(`${name || email} can now sign in — their details have been emailed`, "good");
      } else {
        setEmailProblem({
          name: name.trim() || email,
          password,
          reason: result.emailError ?? "The welcome email wasn't sent.",
        });
      }
      if (result.warning) toast(result.warning, "warn");
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't create that account.");
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  if (emailProblem) {
    return (
      <Modal
        open
        title="Account created"
        onClose={onClose}
        footer={<Button tone="primary" onClick={onClose}>Done</Button>}
      >
        <div className="stack">
          <div className="notice">
            <span>{emailProblem.reason}</span>
          </div>
          <p style={{ margin: 0 }}>
            <strong>{emailProblem.name}</strong> can sign in right now. Pass these on yourself, and ask them
            to change the password from Settings.
          </p>
          <div className="notice notice-flat">
            <div className="stack" style={{ gap: 4, width: "100%" }}>
              <div className="spread"><span className="muted">Email</span><span className="mono">{emailProblem.name}</span></div>
              <div className="spread"><span className="muted">Password</span><span className="mono">{emailProblem.password}</span></div>
            </div>
          </div>
        </div>
      </Modal>
    );
  }

  const tooShort = password.length > 0 && password.length < 8;

  return (
    <Modal
      open
      title="Add someone to the team"
      description="Creates a sign-in and emails them their details."
      onClose={onClose}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Cancel</Button>
          <Button loading={busy} loadingLabel="Creating…"
            tone="primary"
            disabled={busy || !email.trim() || password.length < 8}
            onClick={() => void create()}
          >
            Create the account
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="grid grid-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email" hint="This is what they sign in with.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-2">
          <Field label="Designation" hint={'Printed under their name when they email a customer, e.g. "Sales Manager".'}>
            <Input value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </Field>
          <Field label="Mobile" hint="Printed under their name too, and used by {{sender_phone}} in campaigns. They can change it themselves later.">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98100 12345" />
          </Field>
        </div>
        <Field
          label="Starting password"
          hint="They should change it once they're in."
          error={tooShort ? "At least eight characters." : undefined}
        >
          <Input value={password} onChange={(e) => setPassword(e.target.value)} invalid={tooShort} />
        </Field>
        <Field label="Role" hint={ROLE_NOTE[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        </Field>
        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
      </div>
    </Modal>
  );
}

/* ── editing ───────────────────────────────────────────────────────── */

function EditMember({
  api, member, onSaved, onClose,
}: {
  api: IntegrationsApi;
  member: TeamMember;
  onSaved: (patch: { name: string; email: string; designation: string; phone: string }) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email ?? "");
  const [designation, setDesignation] = useState(member.designation ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError(""); setBusy(true);
    try {
      await api.updateTeamMember(member.id, {
        name: name.trim(), email: email.trim().toLowerCase(), designation: designation.trim(),
        phone: phone.trim(),
      });
      onSaved({
        name: name.trim(), email: email.trim().toLowerCase(),
        designation: designation.trim(), phone: phone.trim(),
      });
      toast("Details updated", "good");
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't update those details.");
    }
    setBusy(false);
  };

  return (
    <Modal
      open
      title={`Edit ${member.name}`}
      onClose={onClose}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Cancel</Button>
          <Button loading={busy} loadingLabel="Saving…" tone="primary" disabled={busy || (!name.trim() && !email.trim())} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-2">
          <Field label="Designation" hint={'Printed under their name when they email a customer, e.g. "Sales Manager".'}>
            <Input value={designation} onChange={(e) => setDesignation(e.target.value)} />
          </Field>
          <Field label="Mobile" hint="Printed under their name too, and used by {{sender_phone}} in campaigns.">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98100 12345" />
          </Field>
        </div>
        <Field label="Email" hint="Changing this changes what they sign in with.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
      </div>
    </Modal>
  );
}

/* ── resetting a password ──────────────────────────────────────────── */

function ResetPassword({
  api, member, onClose,
}: { api: IntegrationsApi; member: TeamMember; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setError(""); setBusy(true);
    try {
      await api.resetTeamPassword(member.id, password);
      /* Nothing emails this out — the admin is standing in front of the
         person, or about to message them. Saying so beats them waiting for
         a mail that isn't coming. */
      toast(`Password changed. Pass it to ${member.name} yourself.`, "good");
      onClose();
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't change that password.");
    }
    setBusy(false);
  };

  const tooShort = password.length > 0 && password.length < 8;

  return (
    <Modal
      open
      title={`Reset ${member.name}'s password`}
      description="They are not emailed. Pass the new password on yourself."
      onClose={onClose}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Cancel</Button>
          <Button loading={busy} loadingLabel="Changing…" tone="primary" disabled={busy || password.length < 8} onClick={() => void save()}>
            Change the password
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="New password" error={tooShort ? "At least eight characters." : undefined}>
          <Input value={password} onChange={(e) => setPassword(e.target.value)} invalid={tooShort} />
        </Field>
        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
      </div>
    </Modal>
  );
}
