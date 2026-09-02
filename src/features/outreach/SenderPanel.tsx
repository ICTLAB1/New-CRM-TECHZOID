import { useEffect, useState } from "react";
import { Button, Card, Input } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { setMyDesignation } from "../../data/session";

/**
 * What {{sender_name}} and the rest will actually say — and where each one
 * comes from.
 *
 * WHY THIS PANEL EXISTS. Somebody opened the composer, saw
 * "{{sender_designation}}" sitting in the message box, and asked where to
 * type it in. That is exactly the right question and the screen had no
 * answer on it: the sender variables are the only ones filled from the
 * WORKSPACE rather than from the person being written to, so unlike
 * {{first_name}} there is no row in the recipients list to point at. They
 * were filled invisibly, somewhere else, and the only way to find out
 * whether yours were set was to send yourself a test and read the result.
 *
 * So this shows the resolved value beside each one, with the place it came
 * from. A blank is called out in red rather than left to be discovered in a
 * purchase manager's inbox — a blank sender variable is not cosmetic, it
 * holds every recipient back under "missing data" and turns a launch into
 * "0 queued, 340 excluded" with no obvious cause.
 *
 * THE JOB TITLE IS EDITABLE HERE, the rest are not. A job title is the one
 * of these that belongs to the person reading the screen; asking them to
 * leave, find Team, open their own row and come back is the sort of trip
 * that ends in the title never being set. Company name, phone and the logo
 * are workspace-wide and shared by quotations, invoices and the portal, so
 * those stay in Settings where changing them is a deliberate act.
 */

export interface SenderValues {
  name: string;
  email: string;
  company: string;
  designation: string;
  phone: string;
}

/** Which of these the message actually uses — so a template that never
 *  mentions the phone number does not nag about a blank one. */
const TOKEN_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;
export function senderTokensUsed(...texts: string[]): Set<string> {
  const used = new Set<string>();
  for (const t of texts) {
    for (const m of String(t ?? "").matchAll(TOKEN_RE)) {
      const name = m[1] ?? "";
      if (name.startsWith("sender_") || name === "signature") used.add(name);
    }
  }
  return used;
}

interface Row {
  token: string;
  label: string;
  value: string;
  /** Where somebody goes to change it, when it is not editable here. */
  source: string;
}

export function senderRows(sender: SenderValues): Row[] {
  return [
    { token: "sender_name", label: "Your name", value: sender.name, source: "Team" },
    { token: "sender_email", label: "Your email", value: sender.email, source: "Team" },
    { token: "sender_designation", label: "Your job title", value: sender.designation, source: "the box below" },
    { token: "sender_company", label: "Company name", value: sender.company, source: "Settings → Company" },
    { token: "sender_phone", label: "Company phone", value: sender.phone, source: "Settings → Company" },
  ];
}

/** "a", "a and b", "a, b and c" — an Oxford-comma-free English list, because
 *  this sentence is read by somebody who is already confused. */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

export function SenderPanel({
  sender, subject, body, onDesignationSaved,
}: {
  sender: SenderValues;
  subject: string;
  body: string;
  onDesignationSaved: (designation: string) => void;
}) {
  const toast = useToast();
  const used = senderTokensUsed(subject, body);
  const rows = senderRows(sender);

  const [title, setTitle] = useState(sender.designation);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(sender.designation); }, [sender.designation]);

  /* Only nag about what this message actually asks for. */
  const holes = rows.filter((r) => used.has(r.token) && !r.value.trim());

  const save = async () => {
    setBusy(true);
    try {
      await setMyDesignation(title);
      onDesignationSaved(title.trim());
      toast("Job title saved", "good");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save your job title.", "bad");
    }
    setBusy(false);
  };

  return (
    <Card title="You, in this email" padded>
      <p className="muted small" style={{ marginTop: 0 }}>
        These are not typed into the message — they fill themselves in from your profile and from
        Settings. What each one will say for you, right now:
      </p>

      <table className="table compact">
        <thead>
          <tr><th>In the message</th><th>Becomes</th><th>Comes from</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const inUse = used.has(r.token);
            const blank = !r.value.trim();
            return (
              <tr key={r.token} style={inUse ? undefined : { opacity: 0.55 }}>
                <td><code>{`{{${r.token}}}`}</code></td>
                <td>
                  {blank
                    ? <span style={{ color: inUse ? "#b91c1c" : undefined }} className={inUse ? undefined : "muted"}>
                        Not set
                      </span>
                    : r.value}
                </td>
                <td className="muted small">{r.label} — set in {r.source}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {holes.length ? (
        <p className="small" style={{ color: "#b91c1c" }}>
          This message uses {listOf(holes.map((h) => `{{${h.token}}}`))}, which {holes.length > 1 ? "are" : "is"} blank.
          A blank value holds every recipient back rather than leaving a hole in the email, so the campaign
          would queue nobody until {holes.length > 1 ? "they are" : "it is"} filled in.
        </p>
      ) : null}

      <div className="row-tight" style={{ alignItems: "flex-end", gap: 8, marginTop: 8 }}>
        <div style={{ flex: "1 1 260px", maxWidth: 320 }}>
          <label className="small muted" htmlFor="sender-title">Your job title</label>
          <Input
            id="sender-title"
            value={title}
            placeholder="Managing Director"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <Button
          tone="primary"
          loading={busy}
          disabled={title.trim() === sender.designation.trim()}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
      <p className="muted small" style={{ margin: "6px 0 0" }}>
        Saved to your own profile, so it is the title on every email you send from here — not
        anybody else's. The company name and phone are shared with quotations and invoices, so those
        are changed in Settings → Company.
      </p>
    </Card>
  );
}
