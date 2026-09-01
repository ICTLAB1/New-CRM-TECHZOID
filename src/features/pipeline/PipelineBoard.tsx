import { useState } from "react";
import { STAGES, applyStage, stageNeedsReason, type LostDetail, type StageId } from "../../domain/pipeline/stages";
import type { Customer } from "../../domain/customers/customer";
import { customerLabel } from "../../domain/customers/customer";
import { formatTotals, moneyShort, totalsByCurrency } from "../../domain/currency/format";
import { backingFor, backingNote, type BackingSource } from "../../domain/pipeline/backing";
import { countsAsWon } from "../../domain/pipeline/stages";
import { fmtDateShort, isOverdue } from "../../domain/dates";
import { LostReasonModal } from "./LostReasonModal";

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
  onChange,
  onOpen,
}: {
  customers: Customer[];
  /** Orders, invoices, proformas and quotations, so a card can say when a
   *  deal is being counted as won with nothing sold. Optional: the board
   *  still works without them, it just cannot make that check. */
  documents?: BackingSource;
  onChange: (next: Customer[]) => void;
  onOpen: (customer: Customer) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<StageId | null>(null);
  const [pendingLost, setPendingLost] = useState<Customer | null>(null);

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
      <div className="board-wrap">
      <div className="board scroll">
        {STAGES.map((stage) => {
          const inStage = customers.filter((c) => (c.stage ?? "lead") === stage.id);
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
              <div className="board-head-total">
                {formatTotals(totalsByCurrency(inStage, (c) => Number(c.value) || 0, (c) => c.currency), moneyShort) || "—"}
              </div>
              <div className="board-body">
                {inStage.map((c) => {
                  const overdue = isOverdue(c.nextFollowUp);
                  /* Counted as revenue with no order or invoice behind it.
                     Shown on the card because this is the screen where the
                     stage gets set, so it is the screen where it gets put
                     right. */
                  const unbacked = documents && countsAsWon(c) && !backingFor(c.id, documents).backed
                    ? backingNote(backingFor(c.id, documents))
                    : "";
                  return (
                    <button
                      key={c.id}
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
                      {Number(c.value) > 0 ? <div className="deal-value">{moneyShort(c.value, c.currency)}</div> : null}
                      {unbacked ? <div className="deal-flag" title={unbacked}>No order yet</div> : null}
                    </button>
                  );
                })}
                {inStage.length === 0 ? <div className="field-hint" style={{ padding: "6px 4px" }}>Nothing here.</div> : null}
              </div>
            </div>
          );
        })}
      </div>
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
