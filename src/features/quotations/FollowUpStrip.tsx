import { useCallback, useEffect, useState } from "react";
import { Button, Chip } from "../../components/primitives";
import { Confirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { fmtDate } from "../../domain/dates";
import {
  autoFollowUpsOn,
  describeSchedule,
  planFollowUps,
  stepsFor,
  stopReason,
  TONE_LABELS,
  type FollowUp,
} from "../../domain/followups/followups";
import { fmtDate as formatDate, TODAY } from "../../domain/dates";
import { cancelFollowUps, followUpsAvailable, listFollowUps } from "../../data/followups";

/**
 * What is queued against this document — or, before it is sent, what will
 * be — and the way to stop it.
 *
 * IT USED TO SAY NOTHING AT ALL WHILE A QUOTATION WAS BEING WRITTEN, on
 * the grounds that a permanent "no follow-ups scheduled" line is noise.
 * That was right about the noise and wrong about the silence: the only
 * mention of follow-ups anywhere was inside the send dialog, so from the
 * editor the feature did not appear to exist. "No options showing for auto
 * follow-ups" is exactly what that looks like from the other side.
 *
 * So a draft now shows the plan: the dates this customer will be chased
 * on if it is sent today, or the reason there will be none. Still nothing
 * at all on a document where chasing makes no sense — an invoice, a
 * purchase order, a quotation already accepted.
 *
 * The Stop button exists because these emails leave without anybody
 * watching. Every automatic message this product can send has to be
 * cancellable from the record it belongs to, by whoever is looking at it —
 * not from a settings screen, and not only by the person who armed it.
 */
export function FollowUpStrip({
  docId,
  docType,
  status,
  validUntil,
  settings = {},
}: {
  docId: string;
  /** Chasing only makes sense on something a customer has to answer. */
  docType?: string;
  status?: string;
  validUntil?: string | null;
  settings?: Record<string, unknown>;
}) {
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

  /* ── nothing armed yet: say what sending would do ──────────────────── */
  if (!rows.length) {
    const chaseable = docType === "quotation" || docType === "proforma";
    if (!chaseable) return null;
    if (!autoFollowUpsOn(settings)) {
      return (
        <Planned
          note="Automatic follow-ups are switched off for this workspace. Settings → Follow-ups turns them back on."
        />
      );
    }

    const stopped = stopReason({ status: status ?? "", validUntil: validUntil ?? undefined });
    if (stopped) return <Planned note={`No follow-ups: ${stopped}.`} />;

    const today = TODAY();
    const planned = planFollowUps(today, stepsFor(settings["followUpSteps"], today, validUntil ?? null), validUntil ?? null);
    if (!planned.length) {
      return (
        <Planned
          note={`There is no room to chase this one — it lapses ${validUntil ? `on ${formatDate(validUntil)}` : "too soon"}. Move Valid until further out to have it followed up.`}
        />
      );
    }

    return (
      <Planned
        note={`If you send this today, ${planned.length === 1 ? "one reminder goes" : `${planned.length} reminders go`} automatically — ${planned
          .map((p) => `${formatDate(p.dueOn)} (${TONE_LABELS[p.tone]?.name ?? p.tone})`)
          .join(", ")}. You can turn them off on the send dialog.`}
      />
    );
  }

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
            <tr><th>When</th><th>Reads as</th><th>How</th><th>To</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-head className="strong">{fmtDate(r.dueOn)}</td>
                <td data-label="Reads as" className="muted">{TONE_LABELS[r.tone]?.name ?? r.tone}</td>
                <td data-label="How" className="muted">{r.channel === "whatsapp" ? "WhatsApp" : "Email"}</td>
                <td data-label="To" className="muted">{r.channel === "whatsapp" ? (r.toPhone || "—") : r.to}</td>
                <td data-actions>
                  <Chip tone={stateTone(r)}>{stateLabel(r)}</Chip>
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

const stateTone = (r: FollowUp) => {
  if (r.state === "sent") return r.deliveryState === "failed" ? "bad" : "good";
  return r.state === "failed" ? "bad" : r.state === "cancelled" ? "neutral" : "accent";
};

/* The reason a follow-up did not go belongs next to the follow-up, not in a
   server log the salesperson cannot reach. */
function stateLabel(r: FollowUp): string {
  if (r.state === "sent") {
    /* What happened to the message beats what we did with it: "Read" is the
       answer to the question somebody is actually asking. */
    if (r.deliveryState === "failed") return r.deliveryDetail ? `Not delivered — ${r.deliveryDetail}` : "Not delivered";
    if (r.deliveryState === "read") return "Read";
    if (r.deliveryState === "delivered") return "Delivered";
    return r.sentAt ? `Sent ${fmtDate(r.sentAt.slice(0, 10))}` : "Sent";
  }
  if (r.state === "failed") return r.error ? `Failed — ${r.error}` : "Failed";
  if (r.state === "cancelled") return r.error ? `Stopped — ${r.error}` : "Stopped";
  return "Scheduled";
}

/** The line a draft shows: what will happen, or why nothing will. */
function Planned({ note }: { note: string }) {
  return (
    <div className="stack" style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
      <div className="row-tight wrap">
        <span className="eyebrow">Follow-ups</span>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>{note}</p>
    </div>
  );
}
