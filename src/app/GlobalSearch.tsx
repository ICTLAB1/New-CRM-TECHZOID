import { useMemo, useRef, useState } from "react";
import type { WorkspaceData } from "../data/useWorkspace";

/**
 * The search box in the header, which until now accepted typing and did
 * nothing with it.
 *
 * Searches what is already loaded — customers, every kind of document,
 * orders and subscriptions — so it answers as you type, with no round trip.
 * Picking a result opens that record.
 */

export interface SearchHit {
  view: string;
  id: string;
  kind: string;
  title: string;
  meta: string;
}

const norm = (s: unknown) => String(s ?? "").toLowerCase();

export function searchWorkspace(data: WorkspaceData, q: string, limit = 10): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  const digits = needle.replace(/\D/g, "");
  const hits: SearchHit[] = [];
  const match = (...fields: unknown[]) =>
    fields.some((f) => norm(f).includes(needle)) || (digits.length >= 4 && fields.some((f) => norm(f).replace(/\D/g, "").includes(digits)));

  for (const c of data.customers) {
    if (match(c.company, c.contact, c.email, c.phone, c.gstin, c.code, c.city)) {
      hits.push({ view: "customers", id: c.id, kind: "Customer", title: c.company || c.contact || "Untitled", meta: [c.contact, c.city, c.phone].filter(Boolean).join(" · ") });
    }
  }
  const docs: [keyof WorkspaceData, string, string][] = [
    ["quotations", "quotations", "Quotation"], ["proformas", "proformas", "Proforma"],
    ["invoices", "invoices", "Tax invoice"], ["purchaseOrders", "purchase-orders", "Purchase order"],
  ];
  for (const [key, view, kind] of docs) {
    for (const d of data[key] as WorkspaceData["quotations"]) {
      if (match(d.number, d.billName, d.vendorName, d.referenceNo, d.subject)) {
        hits.push({ view, id: d.id, kind, title: d.number || "(unnumbered)", meta: [d.billName || d.vendorName, d.status].filter(Boolean).join(" · ") });
      }
    }
  }
  for (const o of data.orders) {
    if (match(o.number, o.billName, o.poNumber, o.quoteNumber, o.proformaNumber)) {
      hits.push({ view: "orders", id: o.id, kind: "Sales order", title: o.number, meta: o.billName });
    }
  }
  for (const s of data.subscriptions) {
    if (match(s.product, s.customerName, s.vendor)) {
      hits.push({ view: "renewals", id: s.id, kind: "Subscription", title: [s.vendor, s.product].filter(Boolean).join(" "), meta: [s.customerName, s.expiryDate && `expires ${s.expiryDate}`].filter(Boolean).join(" · ") });
    }
  }
  /* Exact number or name matches first. */
  return hits
    .sort((a, b) => Number(norm(b.title).startsWith(needle)) - Number(norm(a.title).startsWith(needle)))
    .slice(0, limit);
}

export function GlobalSearch({ data, onOpen }: { data: WorkspaceData; onOpen: (hit: SearchHit) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchWorkspace(data, q), [data, q]);

  const pick = (h: SearchHit | undefined) => {
    if (!h) return;
    onOpen(h);
    setQ(""); setOpen(false); box.current?.blur();
  };

  return (
    <span className="gsearch">
      <input
        ref={box}
        className="topsearch"
        type="search"
        placeholder="Search customers, quotations, invoices, orders…"
        aria-label="Search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
          if (e.key === "Enter") pick(hits[at]);
          if (e.key === "Escape") { setOpen(false); box.current?.blur(); }
        }}
      />
      {open && q.trim().length >= 2 ? (
        <div className="gsearch-menu" role="listbox">
          {hits.length === 0 ? (
            <div className="gsearch-empty">Nothing matches “{q.trim()}”.</div>
          ) : hits.map((h, i) => (
            <button key={h.view + h.id} type="button" role="option" aria-selected={i === at}
              className="gsearch-item" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h)} onMouseEnter={() => setAt(i)}>
              <span className="gsearch-kind">{h.kind}</span>
              <span className="gsearch-title">{h.title}</span>
              <span className="gsearch-meta">{h.meta}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
