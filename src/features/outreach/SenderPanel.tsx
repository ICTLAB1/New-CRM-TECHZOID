import { useEffect, useState } from "react";
import { Button, Card, Input } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { setMyDetails } from "../../data/session";

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
 * THE JOB TITLE AND THE MOBILE ARE EDITABLE HERE, the rest are not. Those
 * two belong to the person reading the screen; asking them to leave, find
 * Team, open their own row and come back is the sort of trip that ends in
 * neither ever being set. The company name, the company number and the logo
 * are workspace-wide and shared by quotations, invoices and the portal, so
 * those stay in Settings where changing them is a deliberate act.
 *
 * The company number is still the fallback for {{sender_phone}} and for the
 * signature, so somebody who has not set a mobile is not left with a blank —
 * but the panel says which of the two is being used, because "the number
 * under my name is not mine" is not something anybody should have to work
 * out from a received email.
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

export function senderRows(sender: SenderValues, companyPhone = ""): Row[] {
  /* Whose number this is, said plainly. Falling back silently is what made
     the switchboard appear under everybody's name in the first place. */
  const phoneSource = sender.phone.trim()
    ? (companyPhone.trim() && sender.phone.trim() === companyPhone.trim()
        ? "Settings → Company (you have no mobile of your own set)"
        : "the box below")
    : "the box below";
  return [
    { token: "sender_name", label: "Your name", value: sender.name, source: "Team" },
    { token: "sender_email", label: "Your email", value: sender.email, source: "Team" },
    { token: "sender_designation", label: "Your job title", value: sender.designation, source: "the box below" },
    { token: "sender_company", label: "Company name", value: sender.company, source: "Settings → Company" },
    { token: "sender_phone", label: "Your mobile", value: sender.phone, source: phoneSource },
  ];
}

/** "a", "a and b", "a, b and c" — an Oxford-comma-free English list, because
 *  this sentence is read by somebody who is already confused. */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

export function SenderPanel({
  sender, myPhone, companyPhone, subject, body, onSaved,
}: {
  sender: SenderValues;
  /** Their own number, before the fallback — so the box shows what THEY set,
   *  not the company's number pre-filled as if it were theirs. */
  myPhone: string;
  companyPhone: string;
  subject: string;
  body: string;
  onSaved: (patch: { designation?: string; phone?: string }) => void;
}) {
  const toast = useToast();
  const used = senderTokensUsed(subject, body);
  const rows = senderRows(sender, companyPhone);

  const [title, setTitle] = useState(sender.designation);
  const [mobile, setMobile] = useState(myPhone);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(sender.designation); }, [sender.designation]);
  useEffect(() => { setMobile(myPhone); }, [myPhone]);

  const dirty = title.trim() !== sender.designation.trim() || mobile.trim() !== myPhone.trim();

  /* Only nag about what this message actually asks for. */
  const holes = rows.filter((r) => used.has(r.token) && !r.value.trim());

  const save = async () => {
    setBusy(true);
    try {
      await setMyDetails({ designation: title, phone: mobile });
      onSaved({ designation: title.trim(), phone: mobile.trim() });
      toast("Saved to your profile", "good");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save your details.", "bad");
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
        <div style={{ flex: "1 1 220px", maxWidth: 280 }}>
          <label className="small muted" htmlFor="sender-title">Your job title</label>
          <Input
            id="sender-title"
            value={title}
            placeholder="Managing Director"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div style={{ flex: "1 1 220px", maxWidth: 280 }}>
          <label className="small muted" htmlFor="sender-mobile">Your mobile</label>
          <Input
            id="sender-mobile"
            value={mobile}
            placeholder="+91 98100 12345"
            onChange={(e) => setMobile(e.target.value)}
          />
        </div>
        <Button tone="primary" loading={busy} disabled={!dirty} onClick={() => void save()}>
          Save
        </Button>
      </div>
      <p className="muted small" style={{ margin: "6px 0 0" }}>
        Both are saved to your own profile, so they are what appears on email you send — not
        anybody else's. Leave the mobile blank to use the company number instead. The company name
        and number are shared with quotations and invoices, so those are changed in Settings →
        Company.
      </p>
    </Card>
  );
}
