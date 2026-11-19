import { useMemo, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { STAGES, applyStage, stageNeedsReason, type LostDetail, type StageId } from "../../domain/pipeline/stages";
import type { Customer } from "../../domain/customers/customer";
import { customerLabel } from "../../domain/customers/customer";
import { formatTotals, moneyList, moneyShort, totalsByCurrency } from "../../domain/currency/format";
import { backingFor, backingNote, type BackingSource } from "../../domain/pipeline/backing";
import { countsAsWon, wonAmount } from "../../domain/pipeline/stages";
import { grandTotalOf, mismatchNote, wonFigure, type ReconcileSource } from "../../domain/pipeline/reconcile";
import { fmtDateShort, isOverdue } from "../../domain/dates";
import { LostReasonModal } from "./LostReasonModal";
import { Button, Card, Input, Select } from "../../components/primitives";
import { SavedViews } from "../../components/SavedViews";

/**
 * The pipeline board. Drag a deal between stages.
 *
 * Uses native HTML drag and drop rather than a library: it is a list of cards
 * moving between seven columns, and a pointer-events implementation would be
 * more code to maintain than the feature is worth. Every card is also a
 * button, so the board is operable without dragging at all.
 */
export function PipelineBoard({
  customers,
  documents,
  sellerState = "",
  users = [],
  onChange,
  onOpen,
}: {
  customers: Customer[];
  /** Orders, invoices, proformas and quotations, so a card can say when a
   *  deal is being counted as won with nothing sold. Optional: the board
   *  still works without them, it just cannot make that check. */
  documents?: BackingSource & ReconcileSource;
  /** Needed to total a document, for the check that a won deal's reported
   *  figure matches its own paperwork. */
  sellerState?: string;
  /** For the owner filter. Without them the board shows everybody's deals,
   *  which is the right default for one person and unreadable for ten. */
  users?: { id: string; name: string }[];
  onChange: (next: Customer[]) => void;
  onOpen: (customer: Customer) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<StageId | null>(null);
  const [pendingLost, setPendingLost] = useState<Customer | null>(null);
  const [owner, setOwner] = useState<string>("all");
  const [query, setQuery] = useState("");

  /* Filtering narrows what the columns show, never what a move writes:
     `move` still maps over every customer, so a deal dragged while the board
     is filtered does not take the hidden ones with it. */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) => {
      if (owner !== "all" && c.ownerId !== owner) return false;
      if (!q) return true;
      return [c.company, c.contact, c.email, c.city].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [customers, owner, query]);

  const move = (customer: Customer, stage: StageId, detail?: LostDetail) => {
    const next = customers.map((c) =>
      c.id === customer.id ? { ...applyStage(c, stage), ...(detail ?? {}), updatedAt: Date.now() } : c,
    );
    onChange(next);
  };

  const drop = (stage: StageId) => {
    setOverStage(null);
    const customer = customers.find((c) => c.id === dragId);
    setDragId(null);
    if (!customer || customer.stage === stage) return;
    /* The move happens now; the reason is asked for afterwards and may be
       skipped. Holding the move hostage to the reason is what makes people
       leave dead deals sitting in Negotiation. */
    move(customer, stage);
    if (stageNeedsReason(stage)) setPendingLost({ ...customer, stage });
  };

  return (
    <>
      <Card padded={false} className="board-filters">
        <SavedViews
          screen="pipeline"
          current={{ owner, query }}
          onApply={(f) => {
            setOwner(f.owner ?? "all");
            setQuery(f.query ?? "");
          }}
        />
        <div className="row wrap" style={{ padding: "var(--gap) var(--gap-wide)" }}>
          <Input
            style={{ maxWidth: 280 }}
            placeholder="Search company, contact, email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {users.length > 1 ? (
            <Select style={{ maxWidth: 180 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="all">Any owner</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          ) : null}
          {owner !== "all" || query ? (
            <Button size="sm" tone="quiet" onClick={() => { setOwner("all"); setQuery(""); }}>
              Clear
            </Button>
          ) : null}
          <span className="grow" />
          <span className="field-hint">
            {shown.length} of {customers.length} deal{customers.length === 1 ? "" : "s"}
          </span>
        </div>
      </Card>

      <div className="board-wrap">
      {/* One layout group, so a card dropped into another column travels
          there instead of vanishing from one and appearing in the other. */}
      <LayoutGroup>
      <div className="board scroll">
        {STAGES.map((stage) => {
          const inStage = shown.filter((c) => (c.stage ?? "lead") === stage.id);
          return (
            <div
              key={stage.id}
              className={"board-col" + (overStage === stage.id ? " is-over" : "")}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage.id); }}
              onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
              onDrop={() => drop(stage.id)}
            >
              <div className="board-head">
                <span className={`stage-dot tone-${stage.tone}`} aria-hidden />
                <span className="board-head-label">{stage.label}</span>
                <span className="board-head-count">{inStage.length}</span>
              </div>
              {/* Per currency. A column holding one dirham deal and one rupee
                  deal has no single total, and printing their sum with a ₹
                  in front is a number in no unit at all. */}
              {/* THE WON COLUMN TOTALS THE WON FIGURES. It used to total
                  `value` for every column alike, so the Won column's own
                  heading disagreed with the dashboard, the revenue report
                  and the cards beneath it — four numbers for one month's
                  sales, which is what "total sales not matching" looked
                  like from the outside. Every other column still totals
                  the estimate, because for an open deal that is the only
                  figure there is. */}
              <div className="board-head-total">
                {formatTotals(
                  totalsByCurrency(
                    inStage,
                    (c) => (countsAsWon(c) ? wonAmount(c) : Number(c.value) || 0),
                    (c) => c.currency,
                  ),
                  moneyShort,
                ) || "—"}
              </div>
              <div className="board-body">
                <AnimatePresence initial={false}>
                {inStage.map((c) => {
                  const overdue = isOverdue(c.nextFollowUp);
                  /* Counted as revenue with no order or invoice behind it.
                     Shown on the card because this is the screen where the
                     stage gets set, so it is the screen where it gets put
                     right. */
                  const unbacked = documents && countsAsWon(c) && !backingFor(c.id, documents).backed
                    ? backingNote(backingFor(c.id, documents))
                    : "";
                  /* Counted as revenue at a figure its own paperwork
                     disagrees with — the reported "total sales not
                     matching the order won". Same reasoning as the line
                     above: this is the screen where the stage gets set, so
                     it is the screen that says so, and opening the card is
                     where it gets put right. */
                  const mismatch = documents && countsAsWon(c)
                    ? mismatchNote(
                        wonFigure(c, documents, grandTotalOf(sellerState)),
                        (n) => moneyList(n, c.currency),
                      )
                    : "";
                  const wonShown = countsAsWon(c) ? wonAmount(c) : Number(c.value) || 0;
                  return (
                    <motion.div
                      key={c.id}
                      layout="position"
                      layoutId={"deal-" + c.id}
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.9 }}
                    >
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setDragId(c.id)}
                      onDragEnd={() => { setDragId(null); setOverStage(null); }}
                      onClick={() => onOpen(c)}
                      className={"deal" + (dragId === c.id ? " is-dragging" : "") + (overdue ? " needs-warn" : "")}
                    >
                      <div className="deal-name truncate">{customerLabel(c)}</div>
                      <div className="deal-meta truncate">
                        <span className="truncate">{c.contact || "No contact"}</span>
                        {c.nextFollowUp ? (
                          <span style={overdue ? { color: "var(--warn)" } : undefined}>
                            {overdue ? "overdue" : fmtDateShort(c.nextFollowUp)}
                          </span>
                        ) : null}
                      </div>
                      {/* A WON CARD SHOWS WHAT IT WAS WON FOR. This used
                          to read `c.value` whatever the stage, so a deal
                          won on a ₹4,72,000 order sat in the Won column
                          showing the ₹50,000 somebody estimated in March
                          while the dashboard showed something else again.
                          wonAmount is the figure the reports count. */}
                      {wonShown > 0 ? <div className="deal-value">{moneyShort(wonShown, c.currency)}</div> : null}
                      {unbacked ? <div className="deal-flag" title={unbacked}>No order yet</div> : null}
                      {mismatch ? <div className="deal-flag" title={mismatch}>Figure disagrees</div> : null}
                    </button>
                    </motion.div>
                  );
                })}
                </AnimatePresence>
                {inStage.length === 0 ? <div className="field-hint" style={{ padding: "6px 4px" }}>Nothing here.</div> : null}
              </div>
            </div>
          );
        })}
      </div>
      </LayoutGroup>
      </div>

      {pendingLost ? (
        <LostReasonModal
          company={customerLabel(pendingLost)}
          onSave={(detail) => { move(pendingLost, "lost", detail); setPendingLost(null); }}
          onSkip={() => setPendingLost(null)}
        />
      ) : null}
    </>
  );
}
