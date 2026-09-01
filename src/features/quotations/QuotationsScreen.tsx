import { useMemo, useRef, useState } from "react";
import { Presence } from "../../components/Presence";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Input, Select, Tabs } from "../../components/primitives";
import { Confirm } from "../../components/Modal";
import { GoodsReceiptDialog } from "../purchasing/GoodsReceiptDialog";
import { removeAttachmentsFor } from "../../data/attachments";
import { useToast } from "../../components/Toast";
import { DocumentEditor } from "./DocumentEditor";
import {
  duplicateQuotation, effectiveStatus, invoiceFrom, newProforma, newPurchaseOrder, newQuotation,
  proformaFromQuotation, INVOICE_STATUSES, PURCHASE_ORDER_STATUSES, QUOTE_STATUSES,
  type DocSettings, type SalesDocument,
} from "../../domain/documents/create";
import type { Customer } from "../../domain/customers/customer";
import { advancesPipeline, concludedAt, isConcluded, stageAfterQuotation } from "../../domain/pipeline/advance";
import { stageOf } from "../../domain/pipeline/stages";
import { buildDocNumber } from "../../domain/numbering/docNumber";
import { SEQ_KEY, nextDocSeq, seqKindOf } from "../../data/docNumber";
import { orderFromProforma, type SalesOrder } from "../../domain/orders/create";
import type { CatalogProduct } from "../../domain/catalog/types";
import { computeDocument } from "../../domain/tax/compute";
import { formatTotals, isMixed, moneyList, totalsByCurrency } from "../../domain/currency/format";
import { fmtDate, isOverdue } from "../../domain/dates";
import { receiptStatusLabel, summarizeReceipts } from "../../domain/purchasing/receipts";
import type { Tone } from "../../components/primitives";
import type { DocImages } from "../../documents/pdf/render";
import type { IntegrationsApi } from "../../integrations/api";

const STATUS_TONE: Record<string, Tone> = {
  Draft: "neutral", Sent: "accent", Accepted: "good", Paid: "good",
  Rejected: "bad", Expired: "bad",
  /* Purchase orders track goods arriving rather than a customer agreeing. */
  Issued: "accent", Acknowledged: "accent", "Partially Received": "warn",
  Received: "good", Cancelled: "bad",
};

export interface QuotationsScreenProps {
  docType: "quotation" | "proforma" | "purchase_order" | "invoice";
  documents: SalesDocument[];
  customers: Customer[];
  catalog: CatalogProduct[];
  settings: Record<string, unknown>;
  brandLogos?: Record<string, { src: string }>;
  docImages?: DocImages;
  api: IntegrationsApi;
  currentUser: { id: string; name: string; email?: string; role?: string };
  onChange: (documents: SalesDocument[], settings: Record<string, unknown>) => void;
  /** Moves the customer along the pipeline board when a quotation reaches
   *  them. Absent on the screens where that would make no sense. */
  onCustomerStage?: (customerId: string, stage: string, requote?: boolean) => void;
  /** Catches this browser up with a counter the database has just advanced.
   *  Local only — it writes nothing back, so it works for a salesperson,
   *  who may not edit settings. */
  onSettingsNote?: (settings: Record<string, unknown>) => void;
  /** Raising a proforma from a quotation hands it to the proformas screen. */
  onCreateProforma?: (proforma: SalesDocument) => void;
  /** Raising a tax invoice hands it to the invoices screen. */
  onCreateInvoice?: (invoice: SalesDocument) => void;
  /** Confirming a proforma as a sales order hands it to the orders screen.
   *  Without this the whole Deliver section — sales orders and the dispatch
   *  challans raised from them — had no way in at all. */
  onCreateOrder?: (order: SalesOrder) => void;
}

export function QuotationsScreen({
  docType, documents, customers, catalog, settings, brandLogos, docImages, api, currentUser,
  onChange, onCustomerStage, onSettingsNote, onCreateProforma, onCreateInvoice, onCreateOrder,
}: QuotationsScreenProps) {
  const toast = useToast();
  const [editing, setEditing] = useState<SalesDocument | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [confirmDelete, setConfirmDelete] = useState<SalesDocument | null>(null);
  const [receiving, setReceiving] = useState<SalesDocument | null>(null);
  const saving = useRef(false);

  const isPo = docType === "purchase_order";
  const isInvoice = docType === "invoice";
  const label = isPo ? "Purchase order" : isInvoice ? "Tax invoice" : docType === "proforma" ? "Proforma" : "Quotation";
  const sellerState = ((settings["company"] as { state?: string })?.state) ?? "Delhi";

  const seqKind = seqKindOf(docType);
  const seqKey = SEQ_KEY[seqKind];
  const prefix = String(
    settings[isPo ? "purchaseOrderPrefix" : isInvoice ? "invoicePrefix" : docType === "proforma" ? "proformaPrefix" : "quotePrefix"]
      ?? (isPo ? "TZ/PO" : isInvoice ? "TZ/INV" : docType === "proforma" ? "TZ/PI" : "TZ/QT"),
  );

  /**
   * The number a document about to be saved for the first time should carry.
   *
   * The counter is advanced by the database, in one statement, because the
   * browser could not do it: `settings` is writable only by an admin or a
   * manager, so a salesperson's bump was rejected by row-level security and
   * the rejection was swallowed — every quotation they raised came out with
   * the same number. See src/data/docNumber.ts.
   *
   * A number somebody typed over is theirs and is returned untouched.
   */
  const allocateNumber = async (doc: SalesDocument): Promise<{ doc: SalesDocument; seq: number | null }> => {
    if (!doc.autoNumber) return { doc, seq: null };
    const seq = await nextDocSeq(seqKind, Number(settings[seqKey]) || 1);
    return { doc: { ...doc, number: buildDocNumber(prefix, seq), autoNumber: false }, seq };
  };

  /** Keep this browser's copy of the counter level with the database, which
   *  the allocation above has just moved. Not a settings edit — nothing is
   *  written back, which is what makes it safe for a salesperson to do. */
  const noteSequence = (seq: number | null) => {
    if (seq === null) return;
    onSettingsNote?.({ ...settings, [seqKey]: seq + 1 });
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (status !== "all" && effectiveStatus(d) !== status) return false;
      if (owner !== "all" && d.ownerId !== owner) return false;
      if (!q) return true;
      return [d.number, d.billName, d.vendorName, d.referenceNo, d.subject].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [documents, query, status, owner]);

  /* Per currency, never one figure. Adding a dollar proforma to a rupee one
     produces a number that is wrong by the whole of the dollar one, and
     looks authoritative doing it. */
  const shownTotals = useMemo(
    () => totalsByCurrency(
      shown,
      (d) => computeDocument(d, sellerState).grand,
      (d) => d.currency,
      String(settings["defaultCurrency"] ?? "INR"),
    ),
    [shown, sellerState, settings],
  );

  const owners = useMemo(
    () => [...new Set(documents.map((d) => d.ownerId))].filter(Boolean),
    [documents],
  );

  const create = () => {
    const opts = { settings: settings as DocSettings, user: currentUser };
    setEditing(
      isPo ? newPurchaseOrder(opts)
        : isInvoice ? invoiceFrom(null, settings as DocSettings, currentUser)
        : docType === "proforma" ? newProforma(opts)
        : newQuotation(opts),
    );
  };

  const save = async (draft: SalesDocument) => {
    /* Allocating a number is a round trip, and the editor stays on screen
       until it comes back. A second click in that window would take a second
       number and file a second copy of the same document. */
    if (saving.current) return;
    saving.current = true;
    try {
      await commit(draft);
    } finally {
      saving.current = false;
    }
  };

  const commit = async (draft: SalesDocument) => {
    const exists = documents.some((d) => d.id === draft.id);
    /* The number is taken when a document is actually saved, so opening the
       editor and cancelling does not leave a hole in the series. */
    const { doc, seq } = exists ? { doc: draft, seq: null } : await allocateNumber(draft);
    const next = exists
      ? documents.map((d) => (d.id === doc.id ? { ...doc, updatedAt: Date.now() } : d))
      : [{ ...doc, updatedAt: Date.now() }, ...documents];
    onChange(next, settings);
    noteSequence(seq);

    /* A quotation the customer has moves the deal to "Quotation Sent".
       Nothing did this before, so the board only ever showed what somebody
       had remembered to drag — see src/domain/pipeline/advance.ts for the
       rules, including the one for quoting an existing client again. */
    let moved: Customer | null = null;
    if (onCustomerStage && doc.customerId && advancesPipeline(docType) && doc.status === "Sent") {
      const customer = customers.find((c) => c.id === doc.customerId);
      const stage = stageAfterQuotation(customer?.stage, {
        concludedAt: concludedAt(customer),
        quotedAt: doc.createdAt,
      });
      if (stage) {
        /* A quotation raised against a customer who was already concluded is
           a genuine re-engagement, and their earlier win stays on the books.
           Anything else is a first-time move up the board, where there is no
           win to keep either way. */
        onCustomerStage(doc.customerId, stage, isConcluded(customer?.stage));
        if (isConcluded(customer?.stage)) moved = customer ?? null;
      }
    }

    setEditing(null);
    toast(`${label} ${doc.number} saved.`, "good");
    /* Bringing a closed deal back onto the board is a bigger thing than a
       save, and it happens to the customer record rather than to the
       document somebody was looking at. Say so, and say what did not
       change: the value they already bought is still in the reports. */
    if (moved) {
      toast(
        `${moved.company || "That customer"} was marked ${stageOf(moved.stage).label} — this quotation puts them back on the board `
        + "under Quotation Sent. What they have already bought stays in the revenue reports.",
        "info",
      );
    }
  };

  const duplicate = async (doc: SalesDocument) => {
    const { doc: copy, seq } = await allocateNumber(duplicateQuotation(doc, settings as DocSettings));
    onChange([copy, ...documents], settings);
    noteSequence(seq);
    toast(`Duplicated as ${copy.number}, back to Draft.`, "good");
  };

  const raiseInvoice = (doc: SalesDocument) => {
    const inv = invoiceFrom(doc, settings as DocSettings, currentUser);
    onCreateInvoice?.(inv);
    toast(`Tax invoice ${inv.number} raised from ${doc.number}.`, "good");
  };

  const confirmOrder = async (doc: SalesDocument) => {
    /* The order number comes from the same database counter every other
       document uses, so two people confirming at once cannot collide. */
    const seq = await nextDocSeq("order", Number(settings["orderSeq"]) || 1);
    const order = {
      ...orderFromProforma(doc, settings as DocSettings),
      number: buildDocNumber(String(settings["orderPrefix"] ?? "TZ/SO"), seq),
    };
    onCreateOrder?.(order);
    onSettingsNote?.({ ...settings, orderSeq: seq + 1 });
    toast(`Sales order ${order.number} confirmed from ${doc.number}.`, "good");
  };

  const raiseProforma = (doc: SalesDocument) => {
    const pf = proformaFromQuotation(doc, settings as DocSettings, currentUser);
    onCreateProforma?.(pf);
    toast(`Proforma ${pf.number} raised from ${doc.number}.`, "good");
  };

  if (editing) {
    return (
      <main className="page">
        <PageHead
          title={`${label} ${editing.number}`}
          sub={(isPo ? editing.vendorName : editing.billName) || (isPo ? "No supplier named yet." : "No customer linked yet.")}
        />
        <DocumentEditor
          doc={editing}
          docType={docType}
          customers={customers}
          catalog={catalog}
          settings={settings}
          brandLogos={brandLogos}
          docImages={docImages}
          api={api}
          currentUser={currentUser}
          /* Attaching a file needs a record that exists. A document the
             editor has only just built is not in the workspace yet. */
          saved={documents.some((d) => d.id === editing.id)}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      </main>
    );
  }

  return (
    <main className="page">
      <PageHead
        title={isPo ? "Purchase orders" : isInvoice ? "Tax invoices" : docType === "proforma" ? "Proforma invoices" : "Quotations"}
        sub={`${documents.length} document${documents.length === 1 ? "" : "s"} this financial year.`}
        actions={<Button tone="primary" onClick={create}>New {label.toLowerCase()}</Button>}
      />

      <Card padded={false}>
        <div style={{ padding: "0 var(--gap-wide)" }}>
          <Tabs
            active={status}
            onChange={setStatus}
            tabs={[
              { id: "all", label: "All", count: documents.length },
              ...(isPo ? PURCHASE_ORDER_STATUSES
                : isInvoice ? INVOICE_STATUSES
                : QUOTE_STATUSES.filter((s) => docType === "quotation" || s !== "Rejected")).map((s) => ({
                id: s,
                label: s,
                count: documents.filter((d) => effectiveStatus(d) === s).length,
              })),
            ]}
          />
        </div>

        <div className="row wrap" style={{ padding: "var(--gap) var(--gap-wide)" }}>
          <Input style={{ maxWidth: 280 }} placeholder="Search number, customer, reference…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select style={{ maxWidth: 170 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">Any owner</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
          <span className="grow" />
          <span className="field-hint">
            {shown.length} shown
            {shownTotals.length ? " · " + formatTotals(shownTotals) : ""}
            {isMixed(shownTotals) ? " — kept apart, not added together" : ""}
          </span>
        </div>

        {shown.length === 0 ? (
          <Empty
            title="Nothing here yet"
            body={query ? `No document matches “${query}”.` : `Create a ${label.toLowerCase()} to get started.`}
            action={<Button tone="primary" onClick={create}>New {label.toLowerCase()}</Button>}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 4 }} />
                  <th>Number</th>
                  <th>{isPo ? "Supplier" : "Customer"}</th>
                  <th>Date</th>
                  <th>{isPo ? "Required by" : isInvoice ? "Payment due" : "Valid until"}</th>
                  <th>Status</th>
                  {/* What has actually turned up, which is a different
                      question from what the buyer did with the order. */}
                  {isPo ? <th>Received</th> : null}
                  <th className="num">Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const totals = computeDocument(d, sellerState);
                  const live = effectiveStatus(d);
                  const stale = live === "Expired" && d.status === "Sent";
                  return (
                    <tr key={d.id} className={stale ? "needs-warn" : undefined}>
                      <td className="edge-cell" />
                      <td data-head className="mono strong" style={{ cursor: "pointer" }} onClick={() => setEditing(d)}>{d.number}</td>
                      <td data-label={isPo ? "Supplier" : "Customer"} className="strong">{(isPo ? d.vendorName : d.billName) || "—"}</td>
                      <td data-label="Date" className="muted">{fmtDate(d.date)}</td>
                      <td data-label={isPo ? "Required by" : isInvoice ? "Payment due" : "Valid until"} className={isOverdue(d.validUntil) ? "" : "muted"} style={isOverdue(d.validUntil) ? { color: "var(--warn)" } : undefined}>
                        {fmtDate(d.validUntil)}
                      </td>
                      <td data-label="Status"><Chip tone={STATUS_TONE[live] ?? "neutral"}>{live}</Chip></td>
                      {isPo ? <td data-label="Received"><ReceiptCell doc={d} /></td> : null}
                      <td data-label="Value" className="num strong">{moneyList(totals.grand, d.currency)}</td>
                      <td data-actions>
                        <span className="row-tight">
                          <Button size="sm" tone="quiet" onClick={() => setEditing(d)}>Edit</Button>
                          {isPo && d.status !== "Cancelled" && d.status !== "Draft" ? (
                            <Button size="sm" tone="default" onClick={() => setReceiving(d)}>Receive</Button>
                          ) : null}
                          {docType === "quotation" || isPo ? (
                            <>
                              <Button size="sm" tone="quiet" onClick={() => duplicate(d)}>Duplicate</Button>
                              {isPo ? null : (
                                <Button size="sm" tone="default" onClick={() => raiseProforma(d)}>Proforma</Button>
                              )}
                            </>
                          ) : null}
                          {onCreateInvoice && !isPo && !isInvoice ? (
                            <Button size="sm" tone="default" onClick={() => raiseInvoice(d)}>Invoice</Button>
                          ) : null}
                          {onCreateOrder && docType === "proforma" ? (
                            <Button size="sm" tone="default" onClick={() => void confirmOrder(d)}>Sales order</Button>
                          ) : null}
                          <Button size="sm" tone="danger" onClick={() => setConfirmDelete(d)}>Delete</Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Confirm
        open={!!confirmDelete}
        title={`Delete ${confirmDelete?.number}?`}
        body={`${confirmDelete?.billName || "This document"} — this cannot be undone, and the number will not be reused.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => {
          /* Nothing cascades from the attachments table to the five tables a
             file can hang off, so the files go with the document here.
             Fire-and-forget: failing to tidy up must never be why a delete
             the user asked for does not happen. */
          if (confirmDelete) void removeAttachmentsFor(docType, confirmDelete.id).catch(() => {});
          onChange(documents.filter((d) => d.id !== confirmDelete?.id), settings);
          toast(`${confirmDelete?.number} deleted.`, "good");
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <Presence value={receiving}>
        {(order, open) => (
        <GoodsReceiptDialog
          /* Remounted whenever the delivery count changes, so the prefilled
             quantities reset to what is NOW outstanding. Without this, the
             inputs would still hold the quantities just recorded and a second
             click would double-count the same delivery. */
          key={order.id + ":" + (order.receipts?.length ?? 0)}
          open={open}
          doc={order}
          currentUser={currentUser}
          onSave={(next) => {
            onChange(documents.map((d) => (d.id === next.id ? next : d)), settings);
            /* Kept open on the freshly saved order, so removing a delivery
               that was just logged does not mean reopening the dialog. */
            setReceiving(next);
          }}
          onClose={() => setReceiving(null)}
        />
        )}
      </Presence>
    </main>
  );
}

/** How much of a purchase order has arrived, at a glance. Derived on every
 *  render from the deliveries logged against it — never a stored figure. */
function ReceiptCell({ doc }: { doc: SalesDocument }) {
  const s = summarizeReceipts(doc);
  if (s.lineCount === 0) return <span className="muted">—</span>;
  const tone: Tone = s.status === "complete" ? "good" : s.status === "over" ? "accent" : s.status === "partial" ? "warn" : "neutral";
  return (
    <span className="row-tight">
      <Chip tone={tone}>{receiptStatusLabel(s.status)}</Chip>
      {s.status === "partial" ? <span className="field-hint">{s.pct}%</span> : null}
    </span>
  );
}
