import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Chip, Field, Textarea } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { inr } from "../../domain/currency/format";
import type { LineItem } from "../../domain/tax/types";
import {
  isQuoteExpired,
  linesNeedingApproval,
  periodEnd,
  type QuoteLineForApproval,
} from "../../domain/priceBook/pricing";
import { localISO } from "../../domain/dates";
import {
  minimumsFor,
  myApprovals,
  notifyApproval,
  requestApproval,
  withdrawApproval,
  type MyApproval,
} from "../../data/priceBook";

/**
 * "Needs Admin approval", and the asking.
 *
 * THE FLOOR IS FETCHED, NOT REMEMBERED. Each line carries the minimum it
 * was added at, which is right for showing what was quoted and wrong for
 * deciding whether this may be sent: a quotation built in November and
 * edited in December is priced against December. So the minimums are read
 * again from the price book every time this strip loads.
 *
 * AND THE ANSWER HERE IS NOT THE CONTROL. The database refuses the send
 * itself — enforce_discount_approval() on public.quotes — so a salesperson
 * who works around this strip meets the same wall a moment later. What
 * this does is tell them before they have written the email.
 */

const REASONS = [
  "Competitor quoted lower",
  "GeM bid",
  "Customer budget",
  "Volume commitment",
  "Long-standing account",
];

export function ApprovalStrip({
  company,
  docId,
  docNumber,
  pricedFrom,
  items,
  onApplyApproved,
}: {
  company: string;
  docId: string;
  docNumber?: string;
  /** 'YYYY-MM' — which month's list this document was priced from. */
  pricedFrom?: string;
  items: readonly LineItem[];
  /** An approved price becomes that line's floor; the editor records it. */
  onApplyApproved: (byLineId: Record<string, number>) => void;
}) {
  const toast = useToast();
  const [minimums, setMinimums] = useState<Map<string, { minPrice: number; sku: string }>>(new Map());
  const [approvals, setApprovals] = useState<MyApproval[]>([]);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<string>(REASONS[0] ?? "Competitor quoted lower");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const bookItems = useMemo(
    () => items.filter((i) => !!i.priceBookItemId).map((i) => String(i.priceBookItemId)),
    [items],
  );

  const load = useCallback(async () => {
    if (!company || !bookItems.length) {
      setMinimums(new Map());
      return;
    }
    try {
      const [mins, mine] = await Promise.all([
        minimumsFor(company, bookItems),
        myApprovals(company).catch(() => [] as MyApproval[]),
      ]);
      setMinimums(new Map([...mins].map(([k, v]) => [k, { minPrice: v.minPrice, sku: v.sku }])));
      setApprovals(mine.filter((a) => a.quoteId === docId));
    } catch (e) {
      setError((e as Error)?.message || "");
    }
  }, [company, bookItems.join(","), docId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = approvals.find((a) => a.state === "pending") ?? null;
  const decided = approvals.find((a) => a.state === "approved" || a.state === "rejected") ?? null;

  /* An approved price per line, applied as that line's floor from now on. */
  const approvedByLine = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of approvals) {
      if (a.state !== "approved") continue;
      for (const l of a.approvedLines) out[l.lineId] = Number(l.approvedPrice) || 0;
    }
    return out;
  }, [approvals]);

  useEffect(() => {
    if (Object.keys(approvedByLine).length) onApplyApproved(approvedByLine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(approvedByLine)]);

  const short: QuoteLineForApproval[] = items
    .filter((i) => i.priceBookItemId)
    .map((i) => ({
      lineId: i.id,
      sku: String(i.sku ?? minimums.get(String(i.priceBookItemId))?.sku ?? ""),
      qty: Number(i.qty) || 1,
      minPrice: minimums.get(String(i.priceBookItemId))?.minPrice ?? null,
      unitPrice: Number(i.rate) || 0,
      approvedPrice: approvedByLine[i.id] ?? i.approvedPrice ?? null,
    }));
  const needed = linesNeedingApproval(short);

  const ask = async () => {
    setBusy(true);
    setError("");
    try {
      const id = await requestApproval({
        company,
        quoteId: docId,
        quoteNumber: docNumber ?? null,
        reason,
        note: note.trim() || null,
        lines: needed.map((n) => {
          const line = items.find((i) => i.id === n.lineId);
          return {
            lineId: n.lineId,
            itemId: String(line?.priceBookItemId ?? ""),
            qty: Number(line?.qty) || 1,
            requestedPrice: n.requestedPrice,
          };
        }),
      });
      /* The record is made; the email is a courtesy on top of it. A
         company with no mailbox connected still gets the approval. */
      const told = await notifyApproval(id);
      toast(
        told.sent
          ? `Sent to ${told.sent === 1 ? "an Admin" : `${told.sent} Admins`} for approval`
          : "Sent for approval — an Admin will see it in the CRM",
        "good",
      );
      setAsking(false);
      setNote("");
      await load();
    } catch (e) {
      setError((e as Error)?.message || "That request could not be sent.");
    }
    setBusy(false);
  };

  const takeBack = async () => {
    if (!pending) return;
    try {
      await withdrawApproval(pending.id);
      toast("Request withdrawn", "good");
      await load();
    } catch (e) {
      toast((e as Error)?.message || "That request could not be withdrawn", "bad");
    }
  };

  /* The month this document was priced from, and whether it has run out.
     A quotation built on November's list and sent in December quotes
     prices the distributor has already replaced. */
  const pricedUntil = pricedFrom ? periodEnd(pricedFrom) : "";
  const stale = isQuoteExpired(pricedUntil, localISO(new Date()));

  /* Nothing to say: no price book lines, nothing below a floor, nothing
     outstanding, and the month it was priced in has not run out. */
  if (!needed.length && !pending && !decided && !stale) return null;

  return (
    <>
      {stale ? (
        <div className="notice notice-warn">
          <div className="stack">
            <div className="row-tight wrap">
              <Chip tone="warn">Priced from an old list</Chip>
              <span>
                These prices came from the {pricedFrom} list, which ran to{" "}
                {new Date(pricedUntil).toLocaleDateString()}. Reprice against the current list before
                sending this again — the distributor's prices have moved on.
              </span>
            </div>
            <div className="row-tight">
              <Button tone="default" onClick={() => void load()}>Check against today's prices</Button>
            </div>
          </div>
        </div>
      ) : null}
      {needed.length && !pending ? (
        <div className="notice notice-warn">
          <div className="stack">
            <div className="row-tight wrap">
              <Chip tone="warn">Needs Admin approval</Chip>
              <span>
                {needed.length === 1 ? "One line is" : `${needed.length} lines are`} below the lowest
                price you may quote. This quotation cannot be sent until an Admin approves it.
              </span>
            </div>
            <ul className="pay-list">
              {needed.map((n) => (
                <li key={n.lineId}>
                  <span className="strong mono">{n.sku || n.lineId}</span>{" "}
                  <span className="muted">
                    {inr(n.requestedPrice)} against a minimum of {inr(n.minPrice)}
                    {n.previouslyApprovedAt
                      ? ` — below the ${inr(n.previouslyApprovedAt)} already approved, so this is a fresh ask`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
            <div className="row-tight">
              <Button tone="primary" onClick={() => setAsking(true)}>Request discount approval</Button>
            </div>
          </div>
        </div>
      ) : null}

      {pending ? (
        <div className="notice">
          <div className="row-tight wrap">
            <Chip tone="warn">Waiting for an Admin</Chip>
            <span>
              Asked {pending.createdAt ? new Date(pending.createdAt).toLocaleDateString() : "just now"} —
              {" "}{pending.reason}. You will be told when it is decided.
            </span>
            <Button tone="quiet" onClick={() => void takeBack()}>Withdraw</Button>
          </div>
        </div>
      ) : null}

      {decided && !pending ? (
        <div className={decided.state === "approved" ? "notice notice-good" : "notice notice-bad"}>
          <div className="stack">
            <div className="row-tight wrap">
              <Chip tone={decided.state === "approved" ? "good" : "bad"}>
                {decided.state === "approved" ? "Approved" : "Not approved"}
              </Chip>
              {decided.decisionNote ? <span>{decided.decisionNote}</span> : null}
            </div>
            {decided.state === "approved" && decided.approvedLines.length ? (
              <ul className="pay-list">
                {decided.approvedLines.map((l) => (
                  <li key={l.lineId}>
                    <span className="muted">
                      {items.find((i) => i.id === l.lineId)?.sku || l.lineId}: approved down to{" "}
                      <span className="strong">{inr(l.approvedPrice)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {asking ? (
        <Modal
          open
          title="Request discount approval"
          description="An Admin sees the cost behind every line and decides."
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button tone="quiet" onClick={() => setAsking(false)}>Cancel</Button>
              <Button tone="primary" loading={busy} loadingLabel="Sending…" onClick={() => void ask()}>
                Send the request
              </Button>
            </>
          }
        >
          <div className="stack">
            <Field label="Why">
              <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Anything else the Admin should know" hint="Optional.">
              <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Customer has three more sites coming in March." />
            </Field>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th className="num">Minimum</th>
                    <th className="num">You want</th>
                  </tr>
                </thead>
                <tbody>
                  {needed.map((n) => (
                    <tr key={n.lineId}>
                      <td data-label="Line" className="mono">{n.sku || n.lineId}</td>
                      <td data-label="Minimum" className="num">{inr(n.minPrice)}</td>
                      <td data-label="You want" className="num strong">{inr(n.requestedPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="field-hint">
              The minimum is read from the price book when the request is made, not taken from this
              screen — so what the Admin sees is what the floor really is.
            </p>
            {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
