import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Field, Input, Tabs, Textarea } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { inr } from "../../domain/currency/format";
import type { Role } from "../../domain/analytics/scope";
import {
  approvalLines,
  approvalQueue,
  decideApproval,
  notifyApproval,
  type ApprovalLine,
  type ApprovalRow,
} from "../../data/priceBook";
import { ORDINARY_DISTRIBUTOR_DISCOUNT_MAX, isUnusualDistributorDiscount } from "../../domain/priceBook/pricing";

/**
 * The approvals inbox: every discount a salesperson has asked for, and the
 * cost behind it.
 *
 * ONLY ADMIN AND MANAGER SEE ANYTHING HERE, and only an Admin can decide.
 * Both are database rules — discount_approvals admits the two roles and
 * decide_discount_approval refuses everyone but an Admin — so a Manager
 * looking at this screen gets the full picture and no working buttons,
 * which is what "sees costs, cannot approve" means.
 *
 * THE DISTRIBUTOR DISCOUNT IS THE POINT OF THE SCREEN. A request at ₹1,050
 * against a ₹1,000 reseller price looks thin until you remember the
 * distributor gives 3.5% — and then the stock cost ₹965 and the deal earns
 * ₹85. The Admin types what they have actually negotiated and every margin
 * on the screen moves; what they typed is recorded with the decision,
 * because six months later "why did we approve that" is only answerable if
 * the number that made it acceptable is written down beside it.
 */

export function ApprovalsScreen({ company, role }: { company: string; role: Role }) {
  const canDecide = role === "Admin";
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [queue, setQueue] = useState<ApprovalRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<ApprovalRow | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setQueue(await approvalQueue(company, tab));
    } catch (e) {
      setError((e as Error)?.message || "The approvals could not be read.");
    }
    setBusy(false);
  }, [company, tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = queue.filter((a) => a.state === "pending").length;

  return (
    <>
      <PageHead
        title="Discount approvals"
        sub={
          canDecide
            ? "Every price a salesperson has asked to go below, with what it costs us."
            : "Every price a salesperson has asked to go below. Deciding is an Admin's."
        }
      />
      <Tabs
        tabs={[
          { id: "pending" as const, label: waiting ? `Waiting (${waiting})` : "Waiting" },
          { id: "all" as const, label: "Everything" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

      {!queue.length && !busy ? (
        <Empty
          title={tab === "pending" ? "Nothing waiting" : "No requests yet"}
          body="When a salesperson prices a line below its minimum, the quotation locks and the request lands here."
        />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quotation</th>
                  <th>Why</th>
                  <th className="num">Lines</th>
                  <th className="num">Asked for</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {queue.map((a) => {
                  const lowest = a.lines.reduce(
                    (worst, l) => Math.min(worst, Number(l.requestedPrice) / Math.max(1, Number(l.minPrice))),
                    1,
                  );
                  return (
                    <tr key={a.id}>
                      <td data-label="Quotation">
                        <div className="strong">{a.quoteNumber || a.quoteId}</div>
                        <div className="muted">
                          {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : ""}
                        </div>
                      </td>
                      <td data-label="Why">
                        <div>{a.reason}</div>
                        {a.note ? <div className="muted">{a.note}</div> : null}
                      </td>
                      <td data-label="Lines" className="num">{a.lines.length}</td>
                      <td data-label="Asked for" className="num">
                        <Chip tone={lowest < 0.9 ? "warn" : "neutral"}>
                          {Math.round((1 - lowest) * 100)}% under
                        </Chip>
                      </td>
                      <td data-label="State">
                        <Chip
                          tone={
                            a.state === "approved" ? "good"
                              : a.state === "rejected" ? "bad"
                              : a.state === "withdrawn" ? "neutral" : "warn"
                          }
                        >
                          {a.state === "pending" ? "Waiting" : a.state}
                        </Chip>
                      </td>
                      <td className="row-tight">
                        <Button tone="quiet" onClick={() => setOpen(a)}>
                          {canDecide && a.state === "pending" ? "Decide" : "Look"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {open ? (
        <DecideDialog
          approval={open}
          canDecide={canDecide && open.state === "pending"}
          onClose={() => setOpen(null)}
          onDecided={() => {
            setOpen(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

function DecideDialog({
  approval, canDecide, onClose, onDecided,
}: {
  approval: ApprovalRow;
  canDecide: boolean;
  onClose: () => void;
  onDecided: () => void;
}) {
  const toast = useToast();
  const [pct, setPct] = useState<string>(
    approval.distributorDiscountPct === null ? "" : String(approval.distributorDiscountPct),
  );
  const [lines, setLines] = useState<ApprovalLine[]>([]);
  const [counters, setCounters] = useState<Record<string, string>>({});
  const [note, setNote] = useState(approval.decisionNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const discount = Number(pct) || 0;

  const load = useCallback(async () => {
    setError("");
    try {
      setLines(await approvalLines(approval.id, discount));
    } catch (e) {
      setError((e as Error)?.message || "The cost picture could not be read.");
    }
  }, [approval.id, discount]);

  /* Reloaded as the Admin types: the margins on screen are the database's
     arithmetic at the discount they have actually negotiated, not the
     browser's guess at it. */
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const decide = async (decision: "approved" | "rejected") => {
    setBusy(true);
    setError("");
    try {
      await decideApproval({
        id: approval.id,
        decision,
        lines: decision === "approved"
          ? lines
              .filter((l) => counters[l.lineId] !== undefined && counters[l.lineId] !== "")
              .map((l) => ({ lineId: l.lineId, approvedPrice: Number(counters[l.lineId]) }))
          : [],
        distributorDiscountPct: pct === "" ? null : discount,
        note: note.trim() || null,
      });
      const told = await notifyApproval(approval.id);
      toast(
        (decision === "approved" ? "Approved — the quotation is unlocked" : "Rejected")
          + (told.sent ? " and the salesperson has been emailed" : ""),
        "good",
      );
      onDecided();
    } catch (e) {
      setError((e as Error)?.message || "That decision could not be saved.");
    }
    setBusy(false);
  };

  const unusual = isUnusualDistributorDiscount(discount);

  return (
    <Modal
      open
      title={`Discount on ${approval.quoteNumber || approval.quoteId}`}
      description={approval.reason}
      onClose={onClose}
      footer={
        canDecide ? (
          <>
            <Button tone="quiet" onClick={onClose}>Close</Button>
            <Button tone="danger" loading={busy} loadingLabel="Saving…" onClick={() => void decide("rejected")}>
              Reject
            </Button>
            <Button tone="primary" loading={busy} loadingLabel="Saving…" onClick={() => void decide("approved")}>
              {Object.values(counters).some((v) => v !== "") ? "Approve at my prices" : "Approve as asked"}
            </Button>
          </>
        ) : (
          <Button tone="quiet" onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="stack">
        {approval.note ? <div className="notice"><span>{approval.note}</span></div> : null}

        <Field
          label="Distributor discount obtained for this deal (%)"
          hint="Usually 0 to 3.5, sometimes more. Every margin below is worked out at this figure, and it is recorded with the decision."
        >
          <Input numeric value={pct} onChange={(e) => setPct(e.target.value)} placeholder="3.5" />
        </Field>
        {unusual ? (
          <div className="notice notice-warn">
            <span>
              {discount}% is above the usual {ORDINARY_DISTRIBUTOR_DISCOUNT_MAX}%. That happens — just make
              sure it is the figure you have actually been given, because the margins below rest on it.
            </span>
          </div>
        ) : null}

        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Qty</th>
                <th className="num">Reseller</th>
                <th className="num">We pay</th>
                <th className="num">Minimum</th>
                <th className="num">Asked</th>
                <th className="num">Margin</th>
                {canDecide ? <th className="num">Approve at</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.lineId}>
                  <td data-label="Product">
                    <div className="strong">{l.productName || l.sku}</div>
                    <div className="muted mono">{l.sku}</div>
                  </td>
                  <td data-label="Qty" className="num">{l.qty}</td>
                  <td data-label="Reseller" className="num">{l.resellerPrice === null ? "—" : inr(l.resellerPrice)}</td>
                  <td data-label="We pay" className="num">{l.buyingPrice === null ? "—" : inr(l.buyingPrice)}</td>
                  <td data-label="Minimum" className="num">{inr(l.minPrice)}</td>
                  <td data-label="Asked" className="num strong">{inr(l.requestedPrice)}</td>
                  <td data-label="Margin" className="num">
                    {l.marginAtRequested === null ? "—" : (
                      <>
                        <Chip tone={l.marginAtRequested < 5 ? "bad" : l.marginAtRequested < 10 ? "warn" : "good"}>
                          {l.marginAtRequested}%
                        </Chip>
                        <div className="muted">{l.markupAtRequested}% over cost</div>
                      </>
                    )}
                  </td>
                  {canDecide ? (
                    <td data-label="Approve at" className="num">
                      <Input
                        numeric
                        value={counters[l.lineId] ?? ""}
                        onChange={(e) => setCounters({ ...counters, [l.lineId]: e.target.value })}
                        placeholder={String(l.requestedPrice)}
                        style={{ maxWidth: 110 }}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="field-hint">
          Leave "Approve at" blank to approve the price asked for. A figure there is a counter-offer —
          higher gives less discount than asked, lower gives more, and whichever it is goes into the
          audit log beside what was requested. Whatever is approved becomes that line's floor: cutting
          below it again needs asking afresh.
        </p>

        {canDecide ? (
          <Field label="Comment" hint="Required on a rejection — the salesperson has to go back to the customer with something.">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : approval.decisionNote ? (
          <div className="notice"><span>{approval.decisionNote}</span></div>
        ) : null}
      </div>
    </Modal>
  );
}
