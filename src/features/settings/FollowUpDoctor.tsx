import { useState } from "react";
import { Button, Chip } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { diagnoseFollowUps, runFollowUpsNow, type FollowUpDiagnosis } from "../../data/verification";

/**
 * Why isn't a follow-up going out.
 *
 * An automatic follow-up passes six gates, every one of them fails
 * silently, and the symptom of all six is the same: nothing happens — at
 * 09:30 the next morning, which is the earliest anybody can notice. This
 * asks the server which gate is closed, and offers to run the due batch
 * now rather than waiting a day to learn which one it was.
 *
 * The most useful line is usually the last: a row that already failed
 * carries the provider's own refusal, and "template name not found" is the
 * whole answer.
 */

interface Check {
  ok: boolean;
  label: string;
  detail?: string;
}

/** The gates, in the order somebody would fix them. */
function checks(d: FollowUpDiagnosis): Check[] {
  const t = d.configured.templateNames;
  const missing = [!t.nudge && "nudge", !t.check && "check", !t.final && "final"].filter(Boolean);

  const list: Check[] = [
    {
      ok: d.configured.interaktKey,
      label: "The WhatsApp key is set",
      detail: d.configured.interaktKey ? undefined : "Add INTERAKT_API_KEY in Netlify and redeploy.",
    },
    {
      ok: d.configured.templatesNamed,
      label: "All three templates are named",
      detail: d.configured.templatesNamed
        ? undefined
        : `Not named: ${missing.join(", ")}. Without all three, a follow-up queues against a name Meta has never seen and is refused when it sends.`,
    },
    {
      ok: d.queue.onWhatsApp > 0,
      label: "Something is queued on WhatsApp",
      detail: d.queue.onWhatsApp > 0
        ? undefined
        : "No follow-up has ever been armed with the WhatsApp box ticked. The box is off by default, and it only appears when the customer has agreed to WhatsApp and has a phone number with a country code. Setting the key does not change sequences already armed — send a quotation again with the box ticked.",
    },
    {
      ok: !d.queue.neverSentAnything,
      label: "The scheduler has run",
      detail: d.queue.neverSentAnything
        ? "Nothing has ever been sent, on any channel. Either nothing has come due yet, or the scheduled function is not running — Netlify → Functions → followups-run should show a schedule of 0 4 * * *. Use “Send due follow-ups now” to settle it."
        : d.queue.lastSentAt ? `Last sent ${new Date(d.queue.lastSentAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.` : undefined,
    },
  ];
  return list;
}

export function FollowUpDoctor() {
  const toast = useToast();
  const [busy, setBusy] = useState<"" | "check" | "run">("");
  const [d, setD] = useState<FollowUpDiagnosis | null>(null);
  const [error, setError] = useState("");

  const look = async () => {
    setBusy("check");
    setError("");
    const answer = await diagnoseFollowUps();
    if (answer.ok) setD(answer.data); else { setD(null); setError(answer.message); }
    setBusy("");
  };

  const run = async () => {
    setBusy("run");
    const answer = await runFollowUpsNow();
    if (!answer.ok) {
      toast(answer.message, "bad");
    } else {
      const t = answer.data.tally;
      toast(
        t
          ? `${t["due"] ?? 0} due · ${t["sent"] ?? 0} sent (${t["whatsapp"] ?? 0} on WhatsApp) · ${t["failed"] ?? 0} failed · ${t["stopped"] ?? 0} stopped.`
          : answer.data.note || "The run finished.",
        (t?.["failed"] ?? 0) > 0 ? "warn" : "good",
      );
      await look();
    }
    setBusy("");
  };

  return (
    <div style={{ marginTop: 20 }}>
      <span className="eyebrow">Why isn&rsquo;t a follow-up going out?</span>
      <p className="muted" style={{ marginTop: 8 }}>
        Six things have to be true and every one of them fails quietly, a day after the send that armed it.
        This says which one is not.
      </p>

      <div className="row-tight" style={{ marginTop: 12 }}>
        <Button size="sm" onClick={() => void look()} loading={busy === "check"} loadingLabel="Looking…">
          Check the queue
        </Button>
        {d ? (
          <Button size="sm" tone="quiet" onClick={() => void run()} loading={busy === "run"} loadingLabel="Sending…">
            Send due follow-ups now
          </Button>
        ) : null}
      </div>

      {error ? <p className="field-msg" style={{ marginTop: 10 }}>{error}</p> : null}

      {d ? (
        <div className="stack" style={{ marginTop: 14 }}>
          <ul className="note-list" style={{ borderTop: 0 }}>
            {checks(d).map((c) => (
              <li key={c.label} className="note">
                <div className="row-tight">
                  <Chip tone={c.ok ? "good" : "warn"}>{c.ok ? "Yes" : "No"}</Chip>
                  <strong style={{ fontSize: "var(--t-small)" }}>{c.label}</strong>
                </div>
                {c.detail ? <p className="note-text" style={{ marginTop: 4 }}>{c.detail}</p> : null}
              </li>
            ))}
          </ul>

          <p className="field-hint">
            {d.queue.total} follow-up{d.queue.total === 1 ? "" : "s"} in the queue — {d.queue.scheduled} waiting
            ({d.queue.dueNow} due now{d.queue.nextDueOn ? `, next on ${d.queue.nextDueOn}` : ""}), {d.queue.sent} sent,
            {" "}{d.queue.failed} failed, {d.queue.cancelled} cancelled.
            {" "}On WhatsApp: {d.queue.whatsappScheduled} waiting, {d.queue.whatsappSent} sent,
            {" "}{d.queue.whatsappDelivered} confirmed delivered.
          </p>

          {d.recentFailures.length ? (
            <div className="stack">
              <div className="eyebrow">What the provider said</div>
              <ul className="note-list">
                {d.recentFailures.map((f, i) => (
                  <li key={i} className="note">
                    <div className="note-head">
                      <strong>{f.docNumber || "A document"}</strong>
                      <span className="field-hint">{f.channel}{f.templateName ? " · " + f.templateName : ""}</span>
                    </div>
                    <p className="note-text">{f.error}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
