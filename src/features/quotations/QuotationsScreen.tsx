import { useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Input, Select, Tabs } from "../../components/primitives";
import { Confirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { DocumentEditor } from "./DocumentEditor";
import {
  duplicateQuotation, effectiveStatus, newProforma, newQuotation, proformaFromQuotation,
  QUOTE_STATUSES, type DocSettings, type SalesDocument,
} from "../../domain/documents/create";
import type { Customer } from "../../domain/customers/customer";
import type { CatalogProduct } from "../../domain/catalog/types";
import { computeDocument } from "../../domain/tax/compute";
import { inrList } from "../../domain/currency/format";
import { fmtDate, isOverdue } from "../../domain/dates";
import type { Tone } from "../../components/primitives";
import type { DocImages } from "../../documents/pdf/render";
import type { IntegrationsApi } from "../../integrations/api";

const STATUS_TONE: Record<string, Tone> = {
  Draft: "neutral", Sent: "accent", Accepted: "good", Paid: "good",
  Rejected: "bad", Expired: "bad",
};

export interface QuotationsScreenProps {
  docType: "quotation" | "proforma";
  documents: SalesDocument[];
  customers: Customer[];
  catalog: CatalogProduct[];
  settings: Record<string, unknown>;
  brandLogos?: Record<string, { src: string }>;
  docImages?: DocImages;
  api: IntegrationsApi;
  currentUser: { id: string; name: string };
  onChange: (documents: SalesDocument[], settings: Record<string, unknown>) => void;
  /** Raising a proforma from a quotation hands it to the proformas screen. */
  onCreateProforma?: (proforma: SalesDocument) => void;
}

export function QuotationsScreen({
  docType, documents, customers, catalog, settings, brandLogos, docImages, api, currentUser,
  onChange, onCreateProforma,
}: QuotationsScreenProps) {
  const toast = useToast();
  const [editing, setEditing] = useState<SalesDocument | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [owner, setOwner] = useState("all");
  const [confirmDelete, setConfirmDelete] = useState<SalesDocument | null>(null);

  const label = docType === "proforma" ? "Proforma" : "Quotation";
  const sellerState = ((settings["company"] as { state?: string })?.state) ?? "Delhi";

  const seqKey = docType === "proforma" ? "proformaSeq" : "quoteSeq";
  const bumpSequence = (s: Record<string, unknown>) => ({ ...s, [seqKey]: (Number(s[seqKey]) || 1) + 1 });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (status !== "all" && effectiveStatus(d) !== status) return false;
      if (owner !== "all" && d.ownerId !== owner) return false;
      if (!q) return true;
      return [d.number, d.billName, d.referenceNo, d.subject].some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [documents, query, status, owner]);

  const owners = useMemo(
    () => [...new Set(documents.map((d) => d.ownerId))].filter(Boolean),
    [documents],
  );

  const create = () => {
    const opts = { settings: settings as DocSettings, user: currentUser };
    setEditing(docType === "proforma" ? newProforma(opts) : newQuotation(opts));
  };

  const save = (doc: SalesDocument) => {
    const exists = documents.some((d) => d.id === doc.id);
    const next = exists
      ? documents.map((d) => (d.id === doc.id ? { ...doc, updatedAt: Date.now() } : d))
      : [{ ...doc, updatedAt: Date.now() }, ...documents];
    /* The sequence only advances once a document is actually saved, so
       opening the editor and cancelling does not burn a number. */
    onChange(next, exists ? settings : bumpSequence(settings));
    setEditing(null);
    toast(`${label} ${doc.number} saved.`, "good");
  };

  const duplicate = (doc: SalesDocument) => {
    const copy = duplicateQuotation(doc, settings as DocSettings);
    onChange([copy, ...documents], bumpSequence(settings));
    toast(`Duplicated as ${copy.number}, back to Draft.`, "good");
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
          sub={editing.billName || "No customer linked yet."}
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
          onSave={save}
          onClose={() => setEditing(null)}
        />
      </main>
    );
  }

  return (
    <main className="page">
      <PageHead
        title={docType === "proforma" ? "Proforma invoices" : "Quotations"}
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
              ...QUOTE_STATUSES.filter((s) => docType === "quotation" || s !== "Rejected").map((s) => ({
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
          <span className="field-hint">{shown.length} shown</span>
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
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Valid until</th>
                  <th>Status</th>
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
                      <td className="mono strong" style={{ cursor: "pointer" }} onClick={() => setEditing(d)}>{d.number}</td>
                      <td className="strong">{d.billName || "—"}</td>
                      <td className="muted">{fmtDate(d.date)}</td>
                      <td className={isOverdue(d.validUntil) ? "" : "muted"} style={isOverdue(d.validUntil) ? { color: "var(--warn)" } : undefined}>
                        {fmtDate(d.validUntil)}
                      </td>
                      <td><Chip tone={STATUS_TONE[live] ?? "neutral"}>{live}</Chip></td>
                      <td className="num strong">{inrList(totals.grand)}</td>
                      <td>
                        <span className="row-tight">
                          <Button size="sm" tone="quiet" onClick={() => setEditing(d)}>Edit</Button>
                          {docType === "quotation" ? (
                            <>
                              <Button size="sm" tone="quiet" onClick={() => duplicate(d)}>Duplicate</Button>
                              <Button size="sm" tone="default" onClick={() => raiseProforma(d)}>Proforma</Button>
                            </>
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
          onChange(documents.filter((d) => d.id !== confirmDelete?.id), settings);
          toast(`${confirmDelete?.number} deleted.`, "good");
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </main>
  );
}
