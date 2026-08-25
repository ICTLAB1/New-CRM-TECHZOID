import { useCallback, useEffect, useState } from "react";
import { Button, Chip } from "../../components/primitives";
import { Confirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { fmtDate } from "../../domain/dates";
import { describeSchedule, TONE_LABELS, type FollowUp } from "../../domain/followups/followups";
import { cancelFollowUps, followUpsAvailable, listFollowUps } from "../../data/followups";

/**
 * What is queued against this document, and the way to stop it.
 *
 * Shown only when there is something to show. A document with no sequence
 * says nothing here — the send dialog already explains what arming would do,
 * and a permanent "no follow-ups scheduled" line on every quotation is noise
 * that trains people to stop reading this area.
 *
 * The Stop button exists because these emails leave without anybody
 * watching. Every automatic message this product can send has to be
 * cancellable from the record it belongs to, by whoever is looking at it —
 * not from a settings screen, and not only by the person who armed it.
 */
export function FollowUpStrip({ docId }: { docId: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<FollowUp[]>([]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!followUpsAvailable() || !docId) return;
    /* A failure here is silence, not an error banner: this is a secondary
       panel on a screen whose job is the document. */
    setRows(await listFollowUps(docId).catch(() => [] as FollowUp[]));
  }, [docId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!rows.length) return null;

  const waiting = rows.filter((r) => r.state === "scheduled");

  const stop = async () => {
    setBusy(true);
    try {
      await cancelFollowUps(docId);
      toast("Follow-ups stopped. Nothing further will be sent for this document.", "good");
      await refresh();
    } catch {
      toast("Couldn't stop those follow-ups. Try again.", "bad");
    }
    setBusy(false);
    setAsking(false);
  };

  return (
    <div className="stack" style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
      <div className="row-tight wrap">
        <span className="eyebrow">Follow-ups</span>
        <span className="grow" />
        {waiting.length ? (
          <Button size="sm" tone="quiet" disabled={busy} onClick={() => setAsking(true)}>
            Stop follow-ups
          </Button>
        ) : null}
      </div>

      <p className="field-hint" style={{ margin: 0 }}>{describeSchedule(rows)}</p>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>When</th><th>Reads as</th><th>To</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-head className="strong">{fmtDate(r.dueOn)}</td>
                <td data-label="Reads as" className="muted">{TONE_LABELS[r.tone]?.name ?? r.tone}</td>
                <td data-label="To" className="muted">{r.to}</td>
                <td data-actions>
                  <Chip tone={stateTone(r.state)}>{stateLabel(r)}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Confirm
        open={asking}
        title="Stop the follow-ups for this document?"
        body={`${waiting.length} scheduled email${waiting.length === 1 ? "" : "s"} will not be sent. Anything already sent stays sent — an email cannot be recalled.`}
        confirmLabel="Stop them"
        tone="danger"
        onConfirm={() => void stop()}
        onCancel={() => setAsking(false)}
      />
    </div>
  );
}

const stateTone = (state: FollowUp["state"]) =>
  state === "sent" ? "good" : state === "failed" ? "bad" : state === "cancelled" ? "neutral" : "accent";

/* The reason a follow-up did not go belongs next to the follow-up, not in a
   server log the salesperson cannot reach. */
function stateLabel(r: FollowUp): string {
  if (r.state === "sent") return r.sentAt ? `Sent ${fmtDate(r.sentAt.slice(0, 10))}` : "Sent";
  if (r.state === "failed") return r.error ? `Failed — ${r.error}` : "Failed";
  if (r.state === "cancelled") return r.error ? `Stopped — ${r.error}` : "Stopped";
  return "Scheduled";
}
