import { useEffect, useRef, useState } from "react";
import { Button, Card, Field, Input, Select, Tabs, Textarea } from "../../components/primitives";
import { DocumentActions } from "./DocumentActions";
import { FollowUpStrip } from "./FollowUpStrip";
import { AttachmentsPanel } from "../attachments/AttachmentsPanel";
import { askBeforeSave, useConfirmedAction } from "../../components/useConfirmedAction";
import { useHotkeys } from "../../components/hotkeys";
import { previewPdf } from "../../documents/pdf/deliver";
import { accountSummary, pickBankAccount, readAccounts } from "../../domain/banking/accounts";
import { documentMargin, marginNote, marginTone } from "../../domain/margin/margin";
import { effectiveCost } from "../../domain/catalog/vendors";
import type { DocImages } from "../../documents/pdf/render";
import type { IntegrationsApi } from "../../integrations/api";
import { Modal } from "../../components/Modal";
import { DocumentPreview } from "../../documents/preview/DocumentPreview";
import type { DocType } from "../../domain/documents/model";
import { LineItemsEditor } from "./LineItemsEditor";
import { useDocumentModel } from "./useDocumentModel";
import {
  applyCustomer, PROFORMA_STATUSES, PURCHASE_ORDER_STATUSES, QUOTE_STATUSES,
  type SalesDocument, type DocSettings,
} from "../../domain/documents/create";
import type { Customer } from "../../domain/customers/customer";
import { TERMS_SETS, suggestTermsSet, LEGAL_NOTICE } from "../../domain/documents/terms";
import { CURRENCIES } from "../../domain/currency/currencies";
import { TAX_TYPES } from "../../domain/tax/types";
import { STATE_NAMES } from "../../domain/geo/states";
import type { CatalogProduct } from "../../domain/catalog/types";
import { moneyList } from "../../domain/currency/format";

/** A4 is 210mm; at 96dpi that is this many CSS pixels. */
const A4_PX = (210 / 25.4) * 96;

/**
 * Scale the preview to whatever width its pane has, and report how tall the
 * scaled result is.
 *
 * A CSS transform does not change layout height, so the wrapper has to be
 * told. Fixing it at one page clipped every document that ran longer — which
 * is most of them, since the terms alone fill half a page.
 */
function useFitScale() {
  const paneRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const measure = () => {
      const next = Math.min(1, pane.clientWidth / A4_PX);
      setScale(next);
      const page = pageRef.current;
      if (page) setHeight(page.getBoundingClientRect().height);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    if (pageRef.current) ro.observe(pageRef.current);
    return () => ro.disconnect();
  }, []);

  return { paneRef, pageRef, scale, height };
}

export interface DocumentEditorProps {
  doc: SalesDocument;
  docType: DocType;
  customers: Customer[];
  catalog: CatalogProduct[];
  settings: Record<string, unknown>;
  brandLogos?: Record<string, { src: string }>;
  /** Artwork for the PDF, which needs pixel dimensions the preview does not. */
  docImages?: DocImages;
  api: IntegrationsApi;
  /** Whose name and address a sent quotation carries. */
  currentUser: { id: string; name: string; email?: string; role?: string };
  /** Whether this document already exists in the workspace. A file attached
   *  to a document that is then cancelled would have nothing pointing at it,
   *  so attaching waits until there is a record to attach to. */
  saved?: boolean;
  onSave: (doc: SalesDocument) => void;
  onClose: () => void;
}

type Tab = "document" | "items" | "terms" | "files";

export function DocumentEditor({
  doc: initial, docType, customers, catalog, settings, brandLogos, docImages, api, currentUser, saved = false, onSave, onClose,
}: DocumentEditorProps) {
  const [doc, setDoc] = useState<SalesDocument>(initial);
  const [tab, setTab] = useState<Tab>("document");
  const [showCatalog, setShowCatalog] = useState(false);
  const { paneRef, pageRef, scale, height } = useFitScale();
  const { totals, model } = useDocumentModel(doc, settings, docType);

  const set = <K extends keyof SalesDocument>(key: K) => (e: { target: { value: string } }) =>
    setDoc((d) => ({ ...d, [key]: e.target.value }));

  /* The accounts to choose from, and which one this document would use if
     nobody chooses — shown in the hint so the automatic answer is visible
     rather than something to be discovered on the PDF. */
  /* The catalog is priced in the company's own currency — a product's
     list price does not change because this quotation is in dollars. */
  const baseCurrency = String(settings["defaultCurrency"] ?? "INR");
  /* What this deal earns, from the costs captured on its own lines. */
  const margin = documentMargin(doc.items);
  const bankAccounts = readAccounts(settings);
  const autoAccount = pickBankAccount(bankAccounts, "", doc.currency);

  const isIndia = !doc.billCountry || doc.billCountry === "India";
  const showTax = doc.taxType !== "none";
  const isPo = docType === "purchase_order";
  const statuses = isPo ? PURCHASE_ORDER_STATUSES : docType === "proforma" ? PROFORMA_STATUSES : QUOTE_STATUSES;

  /* The customer picker is the real entry point for the party, currency and
     tax fields — new documents are always created unlinked. */
  const pickCustomer = (id: string) => {
    const customer = customers.find((c) => c.id === id) ?? null;
    setDoc((d) => applyCustomer(d, customer, settings as DocSettings));
  };

  const addFromCatalog = (product: CatalogProduct) => {
    setDoc((d) => ({
      ...d,
      items: [...d.items, {
        id: Math.random().toString(36).slice(2, 10),
        desc: product.name, subDesc: "", brand: product.publisher || "",
        sku: product.skuId || "", hsn: product.hsn || "997331",
        qty: 1, unit: product.unit || "License", rate: product.sellPrice || "",
        disc: 0, gst: (settings["defaultGst"] as number) ?? 18,
        /* SNAPSHOTTED, not looked up later. A distributor moving a price
           next month must not restate the margin on a quotation sent this
           month — see domain/margin. Taken from the cheapest vendor price
           still live today. */
        cost: effectiveCost(product, new Date().toISOString().slice(0, 10)).cost || undefined,
      }],
    }));
    setShowCatalog(false);
  };

  const suggested = suggestTermsSet(doc.billCountry);

  /* Saving a document is the moment a number gets committed and a customer
     may be sent it, so this asks first — the same question the shortcut
     reaches, since a shortcut that skipped it would make it meaningless. */
  const save = useConfirmedAction({
    title: `Save ${doc.number}?`,
    body: `${totals.rows.length} line${totals.rows.length === 1 ? "" : "s"} · ${moneyList(totals.grand, doc.currency)} grand total.`,
    confirmLabel: "Save",
    onConfirm: () => onSave(doc),
    enabled: askBeforeSave(settings),
  });

  /* Ctrl/Cmd+P opens THIS document rather than the browser's print dialog,
     which would print the editor chrome around it. Held here rather than in
     the actions row so it works from anywhere in the editor. */
  useHotkeys([
    { key: "p", mod: true, run: () => previewPdf({ model, rows: totals.rows, images: docImages }) },
    { key: "s", mod: true, run: save.ask },
    { key: "Enter", mod: true, run: save.ask },
  ]);

  return (
    <>
      <div className="split">
        <div className="stack-wide">
          <Card padded={false}>
            <div style={{ padding: "0 var(--gap-wide)" }}>
              <Tabs
                active={tab}
                onChange={setTab}
                tabs={[
                  { id: "document", label: "Document" },
                  { id: "items", label: "Items", count: doc.items.length },
                  { id: "terms", label: "Terms", count: doc.terms.length },
                  /* Supplier quotes, signed copies, spec sheets — the paper
                     trail behind a document, kept with it. */
                  { id: "files", label: "Files" },
                ]}
              />
            </div>

            <div className="card-pad">
              {tab === "document" ? (
                <div className="stack-wide">
                  <div className="stack">
                    {isPo ? (
                      <Field
                        label="Deliver to a customer"
                        hint="Only for a drop-ship. Leave unset and the goods come to your own address."
                      >
                        <Select
                          value={doc.customerId}
                          onChange={(e) => {
                            const c = customers.find((x) => x.id === e.target.value) ?? null;
                            setDoc((d) => ({
                              ...d,
                              customerId: c?.id ?? "",
                              /* Only the SHIPPING fields follow the customer.
                                 Their billing details must never land on a
                                 purchase order: the party being billed is us. */
                              shipSameAsBilling: !c,
                              shipName: c?.company ?? "",
                              shipAddress: c?.address ?? "",
                              shipState: c?.state ?? "",
                              shipCountry: c?.country ?? "India",
                              shipContact: c?.contact ?? "",
                              shipPhone: c?.phone ?? "",
                              shipEmail: c?.email ?? "",
                              shipGstin: c?.gstin ?? "",
                            }));
                          }}
                        >
                          <option value="">Deliver to our own address</option>
                          {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
                        </Select>
                      </Field>
                    ) : (
                      <Field label="Customer" hint="Sets the billing party, currency and tax regime.">
                        <Select value={doc.customerId} onChange={(e) => pickCustomer(e.target.value)}>
                          <option value="">Not linked to a customer</option>
                          {customers.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
                        </Select>
                      </Field>
                    )}

                    <div className="grid grid-2">
                      <Field
                        label="Document number"
                        hint={doc.autoNumber
                          ? "Confirmed when you save — the database hands out the number, so two people quoting at once cannot get the same one."
                          : undefined}
                      >
                        <Input
                          value={doc.number}
                          onChange={(e) =>
                            /* Typing over the suggestion means this number was
                               chosen deliberately. Saving must then leave it
                               alone rather than replace it with the next one
                               out of the series. */
                            setDoc((d) => ({ ...d, number: e.target.value, autoNumber: false }))}
                        />
                      </Field>
                      <Field label="Status">
                        <Select value={doc.status} onChange={set("status")}>
                          {statuses.map((s) => <option key={s}>{s}</option>)}
                        </Select>
                      </Field>
                      <Field label="Date"><Input type="date" value={doc.date} onChange={set("date")} /></Field>
                      <Field label={isPo ? "Required by" : "Valid until"}><Input type="date" value={doc.validUntil} onChange={set("validUntil")} /></Field>
                      {/* NOT on a purchase order: bank details tell someone
                          where to pay US, and on a document where we are the
                          buyer our own account is at best noise and at worst
                          an invitation to misdirect a payment. */}
                      {!isPo && bankAccounts.length ? (
                        <Field
                          label="Bank account"
                          hint={
                            doc.bankAccountId
                              ? "Printed in the payment details on this document."
                              : autoAccount
                                ? `Using ${accountSummary(autoAccount)} — the one that matches this document. Pick another to override it.`
                                : "No account matches; nothing will print."
                          }
                        >
                          <Select value={doc.bankAccountId ?? ""} onChange={set("bankAccountId")}>
                            <option value="">Choose automatically</option>
                            {bankAccounts.map((a) => (
                              <option key={a.id} value={a.id}>{accountSummary(a)}</option>
                            ))}
                          </Select>
                        </Field>
                      ) : null}
                      <Field label={isPo ? "Supplier reference" : "Customer reference"}><Input value={doc.referenceNo} onChange={set("referenceNo")} placeholder={isPo ? "Their quotation number" : "PO/ABC/2425/078"} /></Field>
                      <Field label="Enquiry reference"><Input value={doc.enquiryRef ?? ""} onChange={set("enquiryRef")} placeholder="ENQ-150826-01" /></Field>
                      <Field label="Customer ID" hint="Printed on the document. Not the database id."><Input value={doc.customerCode ?? ""} onChange={set("customerCode")} placeholder="CUST-000123" /></Field>
                      <Field label="Revision"><Input numeric value={String(doc.revisionNo)} onChange={set("revisionNo")} /></Field>
                      <Field label="Payment terms"><Input value={doc.paymentTerms ?? ""} onChange={set("paymentTerms")} /></Field>
                      <Field label="Delivery terms"><Input value={doc.deliveryTerms ?? ""} onChange={set("deliveryTerms")} /></Field>
                    </div>

                    <Field label="Subject"><Input value={doc.subject} onChange={set("subject")} /></Field>
                  </div>

                  {isPo ? (
                    <div className="stack">
                      <div className="eyebrow">Supplier</div>
                      <p className="field-hint" style={{ marginTop: 0 }}>
                        Who you are ordering from. The Bill To box on the document is your own company,
                        taken from Settings — you do not type it here.
                      </p>
                      <div className="grid grid-2">
                        <Field label="Supplier"><Input value={doc.vendorName ?? ""} onChange={set("vendorName")} placeholder="Distributor name" /></Field>
                        <Field label="Contact"><Input value={doc.vendorContact ?? ""} onChange={set("vendorContact")} /></Field>
                        <Field label="GSTIN"><Input className="mono" value={doc.vendorGstin ?? ""} onChange={set("vendorGstin")} /></Field>
                        <Field label="Phone"><Input value={doc.vendorPhone ?? ""} onChange={set("vendorPhone")} /></Field>
                        <Field label="Email"><Input type="email" value={doc.vendorEmail ?? ""} onChange={set("vendorEmail")} /></Field>
                        <Field label="Country"><Input value={doc.vendorCountry ?? "India"} onChange={set("vendorCountry")} /></Field>
                      </div>
                      <Field label="Address"><Textarea rows={2} value={doc.vendorAddress ?? ""} onChange={set("vendorAddress")} /></Field>
                      <Field label="State" hint="Decides CGST+SGST versus IGST on what they charge you.">
                        <Select value={doc.vendorState ?? ""} onChange={set("vendorState")}>
                          <option value="">Select a state…</option>
                          {STATE_NAMES.map((st) => <option key={st}>{st}</option>)}
                        </Select>
                      </Field>
                    </div>
                  ) : (
                  <div className="stack">
                    <div className="eyebrow">Billing party</div>
                    <div className="grid grid-2">
                      <Field label="Company"><Input value={doc.billName} onChange={set("billName")} /></Field>
                      <Field label="Contact"><Input value={doc.billContact} onChange={set("billContact")} /></Field>
                      <Field label="GSTIN"><Input value={doc.billGstin} onChange={set("billGstin")} /></Field>
                      <Field label="PAN"><Input value={doc.billPan} onChange={set("billPan")} /></Field>
                      <Field label="Email"><Input value={doc.billEmail} onChange={set("billEmail")} /></Field>
                      <Field label="Phone"><Input value={doc.billPhone} onChange={set("billPhone")} /></Field>
                    </div>
                    <Field label="Address"><Textarea rows={2} value={doc.billAddress} onChange={set("billAddress")} /></Field>
                    <div className="grid grid-2">
                      <Field label="Country"><Input value={doc.billCountry} onChange={set("billCountry")} /></Field>
                      <Field label="State" hint={isIndia ? "Decides CGST+SGST versus IGST." : undefined}>
                        {isIndia ? (
                          <Select value={doc.billState} onChange={set("billState")}>
                            <option value="">Select a state…</option>
                            {STATE_NAMES.map((s) => <option key={s}>{s}</option>)}
                          </Select>
                        ) : (
                          <Input value={doc.billState} onChange={set("billState")} />
                        )}
                      </Field>
                    </div>
                  </div>
                  )}

                  <div className="stack">
                    <div className="eyebrow">Shipping</div>
                    <label className="row-tight" style={{ fontSize: "var(--t-body)" }}>
                      <input
                        type="checkbox"
                        checked={doc.shipSameAsBilling !== false}
                        onChange={(e) => setDoc((d) => ({ ...d, shipSameAsBilling: e.target.checked }))}
                      />
                      {isPo ? "Deliver to our own address" : "Ship to the billing address"}
                    </label>
                    {doc.shipSameAsBilling === false ? (
                      <div className="grid grid-2">
                        <Field label="Ship to"><Input value={doc.shipName} onChange={set("shipName")} /></Field>
                        <Field label="Contact"><Input value={doc.shipContact} onChange={set("shipContact")} /></Field>
                        <Field label="Phone"><Input value={doc.shipPhone} onChange={set("shipPhone")} /></Field>
                        <Field label="State"><Input value={doc.shipState} onChange={set("shipState")} /></Field>
                        <div style={{ gridColumn: "1 / -1" }}>
                          <Field label="Address"><Textarea rows={2} value={doc.shipAddress} onChange={set("shipAddress")} /></Field>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="stack">
                    <div className="eyebrow">Commercial</div>
                    <div className="grid grid-2">
                      <Field label="Currency">
                        <Select value={doc.currency} onChange={set("currency")}>
                          {CURRENCIES.map(([code, , name]) => <option key={code} value={code}>{code} — {name}</option>)}
                        </Select>
                      </Field>
                      <Field label="Tax regime">
                        <Select value={doc.taxType} onChange={set("taxType")}>
                          {TAX_TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </Select>
                      </Field>
                    </div>
                    <label className="row-tight" style={{ fontSize: "var(--t-body)" }}>
                      <input type="checkbox" checked={!!doc.roundOff} onChange={(e) => setDoc((d) => ({ ...d, roundOff: e.target.checked }))} />
                      Round the grand total to the nearest unit
                    </label>
                    {docType === "proforma" ? (
                      <Field label="Advance %" hint="A part advance prints its own row on the document.">
                        <Input numeric value={String(doc.advancePercent ?? 100)} onChange={set("advancePercent")} />
                      </Field>
                    ) : null}
                  </div>
                </div>
              ) : tab === "items" ? (
                <LineItemsEditor
                  items={doc.items}
                  rows={totals.rows}
                  currency={doc.currency}
                  showTax={showTax}
                  onChange={(items) => setDoc((d) => ({ ...d, items }))}
                  onPickFromCatalog={() => setShowCatalog(true)}
                />
              ) : tab === "terms" ? (
                <div className="stack-wide">
                  <div className="stack">
                    <div className="row-tight wrap">
                      {TERMS_SETS.map((s) => (
                        <Button
                          key={s.id}
                          tone={s.id === suggested.id ? "primary" : "default"}
                          size="sm"
                          onClick={() => setDoc((d) => ({ ...d, terms: [...s.terms] }))}
                        >
                          Use {s.label}
                        </Button>
                      ))}
                    </div>
                    <div className="field-hint">
                      Suggested for {doc.billCountry || "India"}: <strong>{suggested.label}</strong> — {suggested.hint}.
                      Both sets are always available, and every clause below is editable.
                    </div>
                  </div>

                  <div className="stack">
                    {doc.terms.map((term, i) => (
                      <div className="row" key={i} style={{ alignItems: "flex-start" }}>
                        <span className="field-hint" style={{ width: 18, paddingTop: 6 }}>{i + 1}.</span>
                        <Textarea
                          rows={2}
                          value={term}
                          onChange={(e) => setDoc((d) => ({ ...d, terms: d.terms.map((t, j) => (j === i ? e.target.value : t)) }))}
                        />
                        <Button size="sm" tone="danger" onClick={() => setDoc((d) => ({ ...d, terms: d.terms.filter((_, j) => j !== i) }))}>Remove</Button>
                      </div>
                    ))}
                    <Button tone="default" onClick={() => setDoc((d) => ({ ...d, terms: [...d.terms, ""] }))}>Add a clause</Button>
                  </div>

                  <Field label="Introduction" hint="Printed above the items table on a quotation.">
                    <Textarea rows={2} value={doc.intro ?? ""} onChange={set("intro")} />
                  </Field>
                  <Field label="Closing line">
                    <Textarea rows={2} value={doc.footer ?? ""} onChange={set("footer")} />
                  </Field>

                  <div className="notice">{LEGAL_NOTICE}</div>
                </div>
              ) : null}

              {tab === "files" ? (
                <AttachmentsPanel
                  framed={false}
                  recordType={docType}
                  /* Null until the document has been saved once: the id is
                     stable, but a file attached to a document that is then
                     cancelled would be left with nothing pointing at it. */
                  recordId={saved ? doc.id : null}
                  ownerId={doc.ownerId}
                  currentUser={currentUser}
                />
              ) : null}
            </div>
          </Card>

          <div className="row-tight wrap">
            {save.dialog}
            <Button tone="primary" onClick={save.ask}>Save</Button>
            <Button tone="quiet" onClick={onClose}>Cancel</Button>
            <span className="grow" />
            <span className="field-hint">
              {totals.rows.length} line{totals.rows.length === 1 ? "" : "s"} · {moneyList(totals.grand, doc.currency)} grand total
              {/* INTERNAL. Cost and margin are on this screen and on the
                  record; they are not in the model the PDF is built from,
                  and a test asserts that. */}
              {margin.known ? (
                <>
                  {" · "}
                  <span style={{ color: `var(--${marginTone(margin) === "good" ? "good" : marginTone(margin) === "bad" ? "bad" : "warn"})` }}>
                    {moneyList(margin.amount, doc.currency)} margin
                    {margin.percent !== null ? ` (${margin.percent.toFixed(1)}%)` : ""}
                  </span>
                </>
              ) : null}
              {/* What the figure does NOT cover, and when it should worry
                  somebody. A percentage that quietly treats uncosted lines
                  as pure profit is worse than no percentage at all. */}
              {marginNote(margin) ? (
                <div className={marginTone(margin) === "bad" ? "field-msg" : "field-hint"}>
                  {marginNote(margin)}
                </div>
              ) : null}
            </span>
          </div>

          {/* Sending is separated from saving by a rule, because these leave
              the building: a PDF on someone's disk, an email a customer
              reads, a request in the accounts inbox. Nothing here saves the
              document — what is sent is what is on screen. */}
          <div className="row-tight wrap" style={{ borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
            <DocumentActions
              api={api}
              doc={doc}
              docType={docType}
              model={model}
              rows={totals.rows}
              totals={totals}
              settings={settings}
              images={docImages}
              currentUser={currentUser}
              customer={customers.find((c) => c.id === doc.customerId) ?? null}
              /* Emailing it IS sending it. Recorded here rather than left to
                 somebody remembering to change a dropdown afterwards —
                 which is why quotations sat at "Draft" and their deals sat
                 in Lead. Saved with the document as it stands, because what
                 was just emailed is what is on screen. */
              onSent={() => onSave({ ...doc, status: doc.status === "Draft" ? "Sent" : doc.status })}
            />
          </div>

          {docType === "quotation" || docType === "proforma" ? (
            <FollowUpStrip docId={doc.id} />
          ) : null}
        </div>

        {/* The preview updates as you type, at true A4 proportions. It is
            hidden on a phone: a scaled A4 page is unreadable at that width
            and costs the form half the screen. */}
        <div className="split-preview" ref={paneRef}>
          <div style={{ height: height || undefined }}>
            <div ref={pageRef} style={{ width: "fit-content" }}>
              <DocumentPreview model={model} rows={totals.rows} brandLogos={brandLogos} scale={scale} />
            </div>
          </div>
        </div>
      </div>

      <Modal
        open={showCatalog}
        title="Add from the catalog"
        description={`${catalog.length} product${catalog.length === 1 ? "" : "s"} available.`}
        onClose={() => setShowCatalog(false)}
      >
        <div className="table-wrap" style={{ maxHeight: "50vh" }}>
          <table className="table">
            <thead>
              <tr><th>Product</th><th>Vendor</th><th className="num">Price</th><th /></tr>
            </thead>
            <tbody>
              {catalog.slice(0, 200).map((p) => (
                <tr key={p.id}>
                  <td className="strong">{p.name}</td>
                  <td>{p.publisher}</td>
                  <td className="num">{p.sellPrice ? moneyList(p.sellPrice, baseCurrency) : "—"}</td>
                  <td><Button size="sm" tone="default" onClick={() => addFromCatalog(p)}>Add</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </>
  );
}
