import { Button, Input, Textarea } from "../../components/primitives";
import type { LineItem } from "../../domain/tax/types";
import type { ComputedRow } from "../../domain/tax/types";
import { fmtMoneyCellPdf } from "../../domain/currency/format";

/**
 * The line items.
 *
 * Every field the document can print is editable here: description and the
 * sub-description beneath it, brand, SKU, HSN/SAC, quantity, unit, rate,
 * discount percentage and tax rate. The document's Discount column shows the
 * resulting AMOUNT — the percentage is what a salesperson negotiates, the
 * amount is what a customer reads.
 */
export interface LineItemsEditorProps {
  items: LineItem[];
  rows: ComputedRow[];
  currency: string;
  showTax: boolean;
  onChange: (items: LineItem[]) => void;
  onPickFromCatalog: () => void;
}

export function LineItemsEditor({ items, rows, currency, showTax, onChange, onPickFromCatalog }: LineItemsEditorProps) {
  const set = (id: string, key: keyof LineItem, value: string) =>
    onChange(items.map((it) => (it.id === id ? { ...it, [key]: value } : it)));

  const remove = (id: string) => onChange(items.filter((it) => it.id !== id));

  const move = (index: number, delta: number) => {
    const next = [...items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [row] = next.splice(index, 1);
    next.splice(target, 0, row as LineItem);
    onChange(next);
  };

  const add = () =>
    onChange([
      ...items,
      { id: Math.random().toString(36).slice(2, 10), desc: "", subDesc: "", brand: "", sku: "", hsn: "", qty: 1, unit: "Nos", rate: "", disc: 0, gst: items.at(-1)?.gst ?? 18 },
    ]);

  return (
    <div className="stack">
      {items.map((item, i) => {
        const row = rows[i];
        return (
          <div className="card card-pad" key={item.id} style={{ background: "var(--surface-2)" }}>
            <div className="spread" style={{ marginBottom: "var(--gap-tight)" }}>
              <span className="eyebrow">Item {i + 1}</span>
              <span className="row-tight">
                <Button size="sm" tone="quiet" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</Button>
                <Button size="sm" tone="quiet" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Move down">↓</Button>
                <Button size="sm" tone="danger" onClick={() => remove(item.id)} disabled={items.length === 1}>Remove</Button>
              </span>
            </div>

            <div className="stack">
              <Input value={String(item.desc ?? "")} onChange={(e) => set(item.id, "desc", e.target.value)} placeholder="Product or service description" />
              {/* Multi-line: the design's description cell runs to five or six
                  lines of specification, and a single-line input silently
                  joined them into one. */}
              <Textarea
                rows={2}
                value={String(item.subDesc ?? "")}
                onChange={(e) => set(item.id, "subDesc", e.target.value)}
                placeholder="Specification, term, seat count — one per line, printed beneath the description"
              />

              <div className="grid grid-3">
                <label className="label">Brand
                  <Input value={String(item.brand ?? "")} onChange={(e) => set(item.id, "brand", e.target.value)} />
                </label>
                <label className="label">Part / SKU
                  <Input value={String(item.sku ?? "")} onChange={(e) => set(item.id, "sku", e.target.value)} />
                </label>
                <label className="label">HSN / SAC
                  <Input value={String(item.hsn ?? "")} onChange={(e) => set(item.id, "hsn", e.target.value)} />
                </label>
              </div>

              <div className="grid grid-5">
                <label className="label">Qty
                  <Input numeric value={String(item.qty ?? "")} onChange={(e) => set(item.id, "qty", e.target.value)} />
                </label>
                <label className="label">Unit
                  <Input value={String(item.unit ?? "")} onChange={(e) => set(item.id, "unit", e.target.value)} />
                </label>
                <label className="label">Rate
                  <Input numeric value={String(item.rate ?? "")} onChange={(e) => set(item.id, "rate", e.target.value)} />
                </label>
                <label className="label">Disc %
                  <Input numeric value={String(item.disc ?? "")} onChange={(e) => set(item.id, "disc", e.target.value)} />
                </label>
                <label className="label" style={{ opacity: showTax ? 1 : 0.5 }}>Tax %
                  <Input numeric value={String(item.gst ?? "")} onChange={(e) => set(item.id, "gst", e.target.value)} disabled={!showTax} />
                </label>
              </div>

              {row ? (
                <div className="row-tight wrap field-hint" style={{ justifyContent: "flex-end" }}>
                  <span>Gross {fmtMoneyCellPdf(row.gross, currency)}</span>
                  <span>· Discount {fmtMoneyCellPdf(row.discAmt, currency)}</span>
                  <span>· Taxable <strong>{fmtMoneyCellPdf(row.taxable, currency)}</strong></span>
                  {showTax ? <span>· Tax {fmtMoneyCellPdf(row.tax, currency)}</span> : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}

      <div className="row-tight">
        <Button tone="default" onClick={add}>Add a line</Button>
        <Button tone="default" onClick={onPickFromCatalog}>Add from catalog</Button>
      </div>

      {!showTax ? (
        <div className="field-hint">
          This document is tax exempt, so every line is taxed at zero regardless of the rate above.
        </div>
      ) : null}
    </div>
  );
}
