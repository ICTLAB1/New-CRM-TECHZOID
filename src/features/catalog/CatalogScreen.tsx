import { useMemo, useRef, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Field, Input, Select, Tabs } from "../../components/primitives";
import { Confirm, Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import {
  CATALOG_VENDORS, mergeCatalog, parseProductCatalogWorkbook,
  type CatalogImportResult, type CatalogProduct,
} from "../../domain/catalog";
import { inrList } from "../../domain/currency/format";

/**
 * The product catalog.
 *
 * Its one hard rule, from the brief: **an import saves immediately**. v1
 * parsed a workbook, showed a triumphant summary, and then left the products
 * in component state — close the dialog and the whole import was gone. So
 * here the parse and the save are a single action, and the report is shown
 * afterwards, describing something that has already happened.
 */

export interface CatalogScreenProps {
  catalog: CatalogProduct[];
  canEdit: boolean;
  onChange: (next: CatalogProduct[]) => void;
}

type Filter = "all" | "active" | "inactive";

const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const blank = (): CatalogProduct => ({
  id: uid(), name: "", publisher: "", licenseType: "", productId: "", skuId: "",
  termDuration: "", billingPlan: "", segment: "Commercial",
  costPrice: 0, sellPrice: 0, hsn: "", unit: "Nos.",
  active: true, createdAt: Date.now(), updatedAt: Date.now(),
});

export function CatalogScreen({ catalog, canEdit, onChange }: CatalogScreenProps) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [vendor, setVendor] = useState("all");
  const [editing, setEditing] = useState<CatalogProduct | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CatalogProduct | null>(null);
  const [importing, setImporting] = useState(false);

  const vendors = useMemo(
    () => [...new Set(catalog.map((p) => p.publisher).filter(Boolean))].sort(),
    [catalog],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((p) => {
      if (filter === "active" && !p.active) return false;
      if (filter === "inactive" && p.active) return false;
      if (vendor !== "all" && p.publisher !== vendor) return false;
      if (!q) return true;
      return [p.name, p.publisher, p.skuId, p.productId, p.hsn].some((f) => (f ?? "").toLowerCase().includes(q));
    });
  }, [catalog, query, filter, vendor]);

  const save = (product: CatalogProduct) => {
    const exists = catalog.some((p) => p.id === product.id);
    const next = { ...product, updatedAt: Date.now() };
    onChange(exists ? catalog.map((p) => (p.id === next.id ? next : p)) : [next, ...catalog]);
    setEditing(null);
    toast(exists ? "Product updated" : "Product added", "good");
  };

  const remove = (product: CatalogProduct) => {
    onChange(catalog.filter((p) => p.id !== product.id));
    setConfirmDelete(null);
    toast(`${product.name} removed from the catalog`, "good");
  };

  const counts = {
    all: catalog.length,
    active: catalog.filter((p) => p.active).length,
    inactive: catalog.filter((p) => !p.active).length,
  };

  return (
    <main className="page">
      <PageHead
        title="Product catalog"
        sub="What the quotation editor offers when you add a line."
        actions={canEdit ? (
          <>
            <Button tone="default" onClick={() => setImporting(true)}>Import a price list</Button>
            <Button tone="primary" onClick={() => setEditing(blank())}>Add a product</Button>
          </>
        ) : null}
      />

      <Card padded={false}>
        <div className="card-pad stack">
          <div className="filter-row">
            <Input
              placeholder="Search by name, SKU, product ID or HSN…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: "3 1 240px" }}
            />
            <Select value={vendor} aria-label="Vendor" onChange={(e) => setVendor(e.target.value)}>
              <option value="all">Every vendor</option>
              {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </div>
          <Tabs
            tabs={[
              { id: "all", label: "All", count: counts.all },
              { id: "active", label: "Active", count: counts.active },
              { id: "inactive", label: "Inactive", count: counts.inactive },
            ]}
            active={filter}
            onChange={setFilter}
          />
        </div>

        {rows.length === 0 ? (
          <div className="card-pad">
            <Empty
              title={catalog.length ? "Nothing matches that" : "The catalog is empty"}
              body={catalog.length
                ? "Try a shorter search, or clear the vendor filter."
                : "Import a vendor price list, or add products one at a time."}
              action={canEdit && !catalog.length
                ? <Button tone="primary" onClick={() => setImporting(true)}>Import a price list</Button>
                : null}
            />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Vendor</th>
                  <th>SKU</th>
                  <th>Term</th>
                  <th className="num">Cost</th>
                  <th className="num">Sell</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="truncate" style={{ maxWidth: 340 }}>{p.name}</div>
                      {!p.active ? <Chip tone="neutral">Inactive</Chip> : null}
                    </td>
                    <td>{p.publisher || "—"}</td>
                    <td className="mono">{p.skuId || p.productId || "—"}</td>
                    <td>{p.termDuration || "—"}</td>
                    {/* A product with no price shows a dash, not a zero. Zero
                        is a price; "quote on request" is not. */}
                    <td className="num">{p.costPrice ? inrList(p.costPrice) : "—"}</td>
                    <td className="num">{p.sellPrice ? inrList(p.sellPrice) : "—"}</td>
                    <td>
                      {canEdit ? (
                        <span className="row-tight">
                          <Button size="sm" tone="quiet" onClick={() => setEditing(p)}>Edit</Button>
                          <Button size="sm" tone="danger" onClick={() => setConfirmDelete(p)}>Delete</Button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing ? (
        <ProductSheet product={editing} onSave={save} onClose={() => setEditing(null)} />
      ) : null}

      {importing ? (
        <ImportDialog
          catalog={catalog}
          onClose={() => setImporting(false)}
          onImported={onChange}
        />
      ) : null}

      <Confirm
        open={!!confirmDelete}
        title="Remove this product?"
        body={<>
          <strong>{confirmDelete?.name}</strong> will no longer appear when adding a line to a quotation.
          Documents already quoting it are unaffected.
        </>}
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </main>
  );
}

/* ── one product ───────────────────────────────────────────────────── */

function ProductSheet({
  product, onSave, onClose,
}: { product: CatalogProduct; onSave: (p: CatalogProduct) => void; onClose: () => void }) {
  const [p, setP] = useState(product);
  const set = <K extends keyof CatalogProduct>(key: K) => (e: { target: { value: string } }) =>
    setP((cur) => ({ ...cur, [key]: e.target.value }));
  const setNum = (key: "costPrice" | "sellPrice") => (e: { target: { value: string } }) =>
    setP((cur) => ({ ...cur, [key]: Number(e.target.value) || 0 }));

  const margin = p.sellPrice && p.costPrice ? ((p.sellPrice - p.costPrice) / p.sellPrice) * 100 : null;

  return (
    <Modal
      open
      side
      title={product.name || "New product"}
      onClose={onClose}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Cancel</Button>
          <Button tone="primary" disabled={!p.name.trim()} onClick={() => onSave(p)}>Save</Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Name" hint="Printed on the quotation exactly as written here.">
          <Input value={p.name} onChange={set("name")} />
        </Field>

        <div className="grid grid-2">
          <Field label="Vendor">
            <Input list="catalog-vendors" value={p.publisher} onChange={set("publisher")} />
            <datalist id="catalog-vendors">
              {CATALOG_VENDORS.map((v) => <option key={v} value={v} />)}
            </datalist>
          </Field>
          <Field label="Licence type" hint="Subscription, Perpetual, Hardware, NCE…">
            <Input value={p.licenseType} onChange={set("licenseType")} />
          </Field>
          <Field label="SKU"><Input value={p.skuId} onChange={set("skuId")} /></Field>
          <Field label="Product ID"><Input value={p.productId} onChange={set("productId")} /></Field>
          <Field label="Term"><Input value={p.termDuration} onChange={set("termDuration")} placeholder="1 Year" /></Field>
          <Field label="Billing plan"><Input value={p.billingPlan} onChange={set("billingPlan")} placeholder="Annual" /></Field>
          <Field label="HSN / SAC"><Input value={p.hsn} onChange={set("hsn")} /></Field>
          <Field label="Unit"><Input value={p.unit} onChange={set("unit")} placeholder="Nos." /></Field>
        </div>

        <div className="grid grid-2">
          <Field label="Cost price" hint="What it costs us. Never printed.">
            <Input numeric type="number" value={p.costPrice || ""} onChange={setNum("costPrice")} />
          </Field>
          <Field
            label="Selling price"
            hint={margin === null ? "Leave blank for quote-on-request." : `Margin ${margin.toFixed(1)}%`}
          >
            <Input numeric type="number" value={p.sellPrice || ""} onChange={setNum("sellPrice")} />
          </Field>
        </div>

        <label className="row-tight" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={p.active} onChange={(e) => setP((cur) => ({ ...cur, active: e.target.checked }))} />
          <span>Offer this when adding a line</span>
        </label>
        {/* The brief's rule, stated where someone might otherwise undo it. */}
        <div className="field-hint">
          A product with no price stays available. Hiding priceless products emptied the picker for anyone
          whose list quotes price on request.
        </div>
      </div>
    </Modal>
  );
}

/* ── import ────────────────────────────────────────────────────────── */

function ImportDialog({
  catalog, onImported, onClose,
}: {
  catalog: CatalogProduct[];
  onImported: (next: CatalogProduct[]) => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [vendor, setVendor] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<(CatalogImportResult & { saved: number; kept: number }) | null>(null);

  const run = async (file: File) => {
    setError(""); setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const parsed = parseProductCatalogWorkbook(wb, vendor || null);

      if (!parsed.products.length) {
        setResult({ ...parsed, saved: 0, kept: catalog.length });
        setError("Nothing was imported — no sheet had a column we could read as a product name. The report below lists the column names each sheet actually has; send them over and we'll teach the importer to read them.");
        setBusy(false);
        return;
      }

      /* Saved here, immediately, before anything is shown. v1 showed the
         summary and kept the products in component state, so closing the
         dialog threw the whole import away. */
      const next = mergeCatalog(catalog, parsed.products, mode, vendor || null);
      onImported(next);
      setResult({ ...parsed, saved: parsed.products.length, kept: next.length - parsed.products.length });
      toast(`${parsed.products.length} products imported and saved`, "good");
    } catch (err) {
      setError(err instanceof Error
        ? `That file couldn't be read as a spreadsheet. (${err.message})`
        : "That file couldn't be read as a spreadsheet.");
    }
    setBusy(false);
  };

  return (
    <Modal
      open
      title="Import a price list"
      description="Excel or CSV. Every sheet is read, and every sheet reports back."
      onClose={onClose}
      footer={
        result
          ? <Button tone="primary" onClick={onClose}>Done</Button>
          : <>
              <Button tone="quiet" onClick={onClose}>Cancel</Button>
              <Button tone="primary" disabled={busy} onClick={() => fileInput.current?.click()}>
                {busy ? "Reading…" : "Choose a file"}
              </Button>
            </>
      }
    >
      <div className="stack">
        {!result ? (
          <>
            <Field
              label="Vendor"
              hint="Applied to every row, overriding any Publisher column. Leave blank to use what the file says."
            >
              <Input list="import-vendors" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Microsoft" />
              <datalist id="import-vendors">
                {CATALOG_VENDORS.map((v) => <option key={v} value={v} />)}
              </datalist>
            </Field>

            <Field label="What to do with the existing catalog">
              <Select value={mode} onChange={(e) => setMode(e.target.value as "merge" | "replace")}>
                <option value="merge">Merge — replace only this vendor's products</option>
                <option value="replace">Replace — clear the catalog first</option>
              </Select>
            </Field>
            {mode === "replace" ? (
              <div className="notice">
                <span>
                  Replace removes all {catalog.length} products currently in the catalog, including other
                  vendors'. Merge is almost always what you want.
                </span>
              </div>
            ) : null}

            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void run(file);
              }}
            />
          </>
        ) : null}

        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

        {result ? (
          <>
            {result.saved ? (
              <div className="notice notice-good">
                <span>
                  <strong>{result.saved} products imported and saved.</strong>{" "}
                  {mode === "merge"
                    ? `${result.kept} products from other vendors were left alone.`
                    : "The previous catalog was replaced."}
                </span>
              </div>
            ) : null}

            <div>
              <span className="eyebrow">Every sheet in the file</span>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table className="table">
                  <thead>
                    <tr><th>Sheet</th><th className="num">Rows</th><th className="num">Imported</th><th>Notes</th></tr>
                  </thead>
                  <tbody>
                    {result.sheetStats.map((s) => (
                      <tr key={s.name}>
                        <td>{s.name}</td>
                        <td className="num">{s.totalRows}</td>
                        <td className="num">{s.count}</td>
                        <td>
                          {s.count === 0 ? (
                            <span className="muted">
                              {/* The whole point of the report: a sheet that
                                  gave nothing says which columns it has. */}
                              Nothing read. Columns seen: {s.columns.length ? s.columns.join(", ") : "none"}
                            </span>
                          ) : s.inferred ? (
                            <span className="muted">
                              {/* Generous inference is deliberate — a price
                                  list must never contribute zero rows just
                                  because its columns are named oddly. The
                                  cost is that a notes sheet can produce a
                                  product, so the report says to look. */}
                              Column names weren't recognised — read “{s.inferred.nameKey}” as the name
                              {s.inferred.priceKey ? ` and “${s.inferred.priceKey}” as the price` : ""}.
                              Worth checking what it added.
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
