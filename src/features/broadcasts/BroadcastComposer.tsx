import { useState } from "react";
import { Button, Card, Field, Input, Select, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { sendBroadcast } from "../../data/broadcasts";
import {
  DEFAULT_EXPIRY_HOURS, EXPIRY_CHOICES, TONES, whyNotSendable,
} from "../../domain/broadcasts/broadcasts";

/**
 * Putting a message on everybody's screen.
 *
 * Admins and managers only — enforced by row-level security, not by hiding
 * the button, because a hidden button is not a permission.
 *
 * The wording around it is deliberately discouraging about volume. This
 * interrupts every person in the company mid-task; the value of that is
 * entirely in its rarity, and a team that gets three a day stops reading
 * the one that matters.
 */
export function BroadcastComposer({
  currentUser, users,
}: {
  currentUser: { id: string; role?: string };
  users: { id: string; name: string }[];
}) {
  const toast = useToast();
  const [toId, setToId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tone, setTone] = useState("info");
  const [hours, setHours] = useState(DEFAULT_EXPIRY_HOURS);
  const [busy, setBusy] = useState(false);

  const problem = whyNotSendable({ title, body });
  const audience = toId ? (users.find((u) => u.id === toId)?.name ?? "one person") : "everyone";

  const send = async () => {
    setBusy(true);
    const result = await sendBroadcast({
      fromId: currentUser.id, toId: toId || null, title, body, tone, expiresInHours: hours,
    });
    setBusy(false);
    if (!result.ok) { toast(result.message, "bad"); return; }
    toast(`Sent to ${audience}. It shows once on each person's screen.`, "good");
    setTitle(""); setBody("");
  };

  return (
    <Card title="Send a message">
      <p className="muted" style={{ marginTop: 0 }}>
        Puts a popup on the screen of everyone you send it to, the moment they next look. For the things that
        cannot wait — the portal is down, prices change on Monday, stop quoting that product.
      </p>

      <div className="notice" style={{ marginTop: 12 }}>
        <span>
          It interrupts people mid-task, and it is worth doing <strong>because it is rare</strong>. A team that
          gets three a day stops reading the one that matters.
        </span>
      </div>

      <div className="stack-wide" style={{ marginTop: 16 }}>
        <div className="grid grid-2">
          <Field label="Who sees it">
            <Select value={toId} onChange={(e) => setToId(e.target.value)}>
              <option value="">Everyone</option>
              {users.filter((u) => u.id !== currentUser.id).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="How it reads" hint={TONES.find((t) => t.id === tone)?.hint}>
            <Select value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Heading" hint="The one line somebody reads if they read nothing else.">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="GST portal is down" />
        </Field>

        <Field label="Message" hint="Optional. Keep it to what they need to do about it.">
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)}
            placeholder="Don't raise invoices until this clears — I'll send another message when it's back." />
        </Field>

        <Field label="Keep showing it for" hint="After this it stops appearing, read or not.">
          <Select value={String(hours)} onChange={(e) => setHours(Number(e.target.value))}>
            {EXPIRY_CHOICES.map((c) => <option key={c.hours} value={c.hours}>{c.label}</option>)}
          </Select>
        </Field>

        <div className="row-tight">
          <Button tone="primary" onClick={() => void send()} disabled={!!problem} loading={busy} loadingLabel="Sending…">
            Send to {audience}
          </Button>
          <span className="field-hint">
            {problem || "Shown once on each person's screen, then never again."}
          </span>
        </div>
      </div>
    </Card>
  );
}
