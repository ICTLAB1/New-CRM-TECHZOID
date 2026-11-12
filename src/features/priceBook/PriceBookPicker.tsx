import { useCallback, useEffect, useState } from "react";
import { Button, Empty, Field, Input, Select } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { inr } from "../../domain/currency/format";
import { searchPriceBook, type PriceBookHit } from "../../data/priceBook";
import { PRICE_BOOK_OEMS } from "./PriceBookScreen";

/**
 * Adding a line from the price book.
 *
 * THE PRICE IT PUTS ON THE LINE IS THE MINIMUM SELLING PRICE, because that
 * is the only price this person has. It is a floor, not a target — the
 * salesperson raises it, and the editor says so. Defaulting to the floor
 * is the honest default: the alternative is defaulting to nothing and
 * having every quotation start from a blank rate.
 *
 * NOTHING ABOUT COST COMES THROUGH HERE. price_book_search has no cost
 * column in its result type at all, so there is none to leave out.
 */
export function PriceBookPicker({
  company,
  currency,
  onAdd,
  onClose,
}: {
  company: string;
  currency: string;
  onAdd: (hit: PriceBookHit) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [oem, setOem] = useState("");
  const [hits, setHits] = useState<PriceBookHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setHits(await searchPriceBook(company, query, oem || null, 100));
    } catch (e) {
      setError((e as Error)?.message || "The price book could not be searched.");
    }
    setBusy(false);
  }, [company, query, oem]);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  return (
    <Modal
      open
      title="Add from the price book"
      description="The price shown is the lowest you may quote. Raise it on the line afterwards."
      onClose={onClose}
      footer={<Button tone="quiet" onClick={onClose}>Close</Button>}
    >
      <div className="stack">
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <Field label="Search">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Part number or product name" autoFocus />
          </Field>
          <Field label="OEM">
            <Select value={oem} onChange={(e) => setOem(e.target.value)}>
              <option value="">All</option>
              {PRICE_BOOK_OEMS.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </Field>
          <Button type="submit" tone="primary" loading={busy} loadingLabel="Searching…">Search</Button>
        </form>

        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

        {!hits.length && !busy ? (
          <Empty
            title="Nothing matched"
            body="Only products in the live monthly list are here. Anything else goes on as a line you type yourself, and has no minimum."
          />
        ) : (
          <div className="table-wrap" style={{ maxHeight: "50vh" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th className="num">Lowest you may quote</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={h.itemId}>
                    <td data-label="Product">
                      <div className="strong">{h.productName}</div>
                      <div className="muted">
                        {[h.oem, h.licenceType, h.unit].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td data-label="SKU" className="mono">{h.sku}</td>
                    <td data-label="Lowest you may quote" className="num strong">
                      {h.currency === currency || h.currency === "INR"
                        ? inr(h.minPrice)
                        : `${h.currency} ${h.minPrice.toFixed(2)}`}
                    </td>
                    <td>
                      <Button size="sm" tone="default" onClick={() => onAdd(h)}>Add</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
