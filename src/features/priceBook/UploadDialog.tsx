import { useRef, useState } from "react";
import { Button, Chip, Field, Input, Select } from "../../components/primitives";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { inr } from "../../domain/currency/format";
import {
  readFileAsBase64,
  uploadPriceList,
  type ColumnMapping,
  type UploadRequest,
  type UploadResult,
} from "../../data/priceBook";
import { PRICE_BOOK_OEMS } from "./PriceBookScreen";

/**
 * Loading a month's OEM price list.
 *
 * FOUR THINGS HAPPEN HERE AND THE ORDER MATTERS. Choose the file; say which
 * column is which, if the server could not tell; read what it found and
 * what the new prices do to the live list; then load it. Nothing is written
 * until the last step, and the server parses the file the same way at every
 * step — the preview is not a different code path that might read the file
 * differently from the load.
 *
 * THE CHANGES REPORT IS THE POINT OF THE PREVIEW. A list where every price
 * has jumped 400% is a list with the wrong column mapped, and finding that
 * out after loading it means every quotation raised in between was priced
 * off nonsense. So the comparison against the live list is in front of the
 * Admin before the button that writes anything.
 *
 * THE FILE IS SENT AGAIN ON THE LOAD rather than held on the server between
 * the two steps. There is no half-finished upload to expire, and the rows
 * that get written are read from the file being looked at.
 */

const FIELD_LABELS: Record<string, string> = {
  sku: "SKU / Part No",
  productName: "Product Name",
  category: "Category",
  licenceType: "Licence Type / Term",
  unit: "Unit",
  resellerPrice: "Reseller Price",
  currency: "Currency",
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function UploadDialog({
  company,
  onClose,
  onLoaded,
}: {
  company: string;
  onClose: () => void;
  onLoaded: () => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const now = new Date();

  const [oem, setOem] = useState<string>(PRICE_BOOK_OEMS[0]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [activate, setActivate] = useState(true);

  const [file, setFile] = useState<{ name: string; base64: string } | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [sheet, setSheet] = useState<string>("");
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (over: Partial<UploadRequest> = {}, chosen = file) => {
    if (!chosen) return;
    setBusy(true);
    setError("");
    try {
      const out = await uploadPriceList({
        company,
        oem,
        year,
        month,
        fileName: chosen.name,
        fileBase64: chosen.base64,
        ...(sheet ? { sheet } : {}),
        ...(headerRow !== null ? { headerRow } : {}),
        ...(mapping ? { mapping } : {}),
        activate,
        ...over,
      });
      setResult(out);
      if (out.mapping && !mapping) setMapping(out.mapping);
      if (out.sheet && !sheet) setSheet(out.sheet);
      if (typeof out.headerRow === "number" && headerRow === null) setHeaderRow(out.headerRow);
      if (out.stage === "loaded") {
        toast(
          `${out.itemsLoaded} products loaded for ${oem} ${year}-${String(month).padStart(2, "0")}`
            + (out.activated ? " and this is now the live list" : ""),
          "good",
        );
      }
    } catch (e) {
      setError((e as Error)?.message || "That file could not be read.");
    }
    setBusy(false);
  };

  const choose = async (picked: File) => {
    setResult(null);
    setMapping(null);
    setSheet("");
    setHeaderRow(null);
    setError("");
    try {
      const base64 = await readFileAsBase64(picked);
      const next = { name: picked.name, base64 };
      setFile(next);
      await send({}, next);
    } catch (e) {
      setError((e as Error)?.message || "That file could not be read.");
    }
  };

  const stage = result?.stage ?? "choose";
  const loaded = stage === "loaded";

  return (
    <Modal
      open
      title="Load a price list"
      description="One .xlsx per OEM per month. Read on the server; nothing is saved until you say so."
      onClose={onClose}
      footer={
        loaded ? (
          <Button tone="primary" onClick={onLoaded}>Done</Button>
        ) : (
          <>
            <Button tone="quiet" onClick={onClose}>Cancel</Button>
            {stage === "preview" && result?.itemCount ? (
              <Button
                tone="primary"
                loading={busy}
                loadingLabel="Loading…"
                onClick={() => void send({ commit: true })}
              >
                Load {result.itemCount} products
              </Button>
            ) : stage === "confirm" ? (
              <Button
                tone="primary"
                loading={busy}
                loadingLabel="Loading…"
                onClick={() => void send({ commit: true, acceptErrors: true })}
              >
                Load the {result?.itemCount} that are ready
              </Button>
            ) : stage === "mapping" ? (
              <Button tone="primary" loading={busy} loadingLabel="Reading…" onClick={() => void send()}>
                Read it again
              </Button>
            ) : (
              <Button
                tone="primary"
                loading={busy}
                loadingLabel="Reading…"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                Choose the .xlsx
              </Button>
            )}
          </>
        )
      }
    >
      <div className="stack">
        <div className="row">
          <Field label="OEM">
            <Input list="upload-oems" value={oem} onChange={(e) => setOem(e.target.value)} disabled={!!result} />
            <datalist id="upload-oems">
              {PRICE_BOOK_OEMS.map((o) => <option key={o} value={o} />)}
            </datalist>
          </Field>
          <Field label="Month">
            <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={!!result}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Year">
            <Input numeric value={year} onChange={(e) => setYear(Number(e.target.value) || year)} disabled={!!result} />
          </Field>
        </div>

        {!loaded ? (
          <label className="row-tight">
            <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
            <span>
              Make this the live list for {oem} as soon as it loads. Untick to load it and check it first —
              it sits as "not live yet" until you make it live.
            </span>
          </label>
        ) : null}

        <input
          ref={fileInput}
          type="file"
          accept=".xlsx"
          style={{ display: "none" }}
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            if (picked) void choose(picked);
          }}
        />

        {file ? (
          <p className="field-hint">
            {file.name}
            {" · "}
            <button type="button" className="link-btn" onClick={() => fileInput.current?.click()}>choose a different file</button>
          </p>
        ) : null}

        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

        {/* ── say which column is which ───────────────────────────────── */}
        {stage === "mapping" && result ? (
          <>
            <div className="notice notice-warn"><span>{result.message}</span></div>
            <SheetPicker result={result} sheet={sheet} onSheet={setSheet} headerRow={headerRow} onHeaderRow={setHeaderRow} />
            <MappingFields
              headers={result.headers ?? []}
              mapping={mapping ?? result.mapping ?? {}}
              onChange={setMapping}
            />
          </>
        ) : null}

        {/* ── what the server found ───────────────────────────────────── */}
        {stage === "preview" && result ? (
          <>
            <div className="row">
              <Chip tone="good">{result.itemCount} products ready</Chip>
              {result.errorCount ? <Chip tone="warn">{result.errorCount} rows cannot be read</Chip> : null}
              {result.truncated ? <Chip tone="warn">Only the first rows were read</Chip> : null}
            </div>
            <p className="field-hint">
              Read from <strong>{result.sheet}</strong>, headings on row {(result.headerRow ?? 0) + 1},
              columns matched from {result.mappingFrom}.{" "}
              <button type="button" className="link-btn" onClick={() => setResult({ ...result, stage: "mapping" })}>
                Change the columns
              </button>
            </p>

            <Changes result={result} oem={oem} />
            <Preview result={result} />
            <Problems result={result} />
          </>
        ) : null}

        {/* ── there are bad rows; say whether to go on ─────────────────── */}
        {stage === "confirm" && result ? (
          <>
            <div className="notice notice-warn"><span>{result.message}</span></div>
            <p className="field-hint">
              The rows that cannot be read will not be in the price book at all, so nobody will be able to
              quote them from it. If they are products you sell, fix the file and upload it again.
            </p>
            <Problems result={result} />
          </>
        ) : null}

        {/* ── done ────────────────────────────────────────────────────── */}
        {loaded && result ? (
          <div className="stack">
            <div className="notice notice-good">
              <span>
                {result.itemsLoaded} products loaded for {oem} {year}-{String(month).padStart(2, "0")}
                {result.replaced ? ", replacing the file loaded for that month before" : ""}
                {result.activated ? ". This is now the live list." : ". It is not live yet — make it live when you are ready."}
              </span>
            </div>
            {result.errorCount ? (
              <p className="field-hint">{result.errorCount} rows were left out. They are listed below.</p>
            ) : null}
            <Problems result={result} />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function SheetPicker({
  result, sheet, onSheet, headerRow, onHeaderRow,
}: {
  result: UploadResult;
  sheet: string;
  onSheet: (v: string) => void;
  headerRow: number | null;
  onHeaderRow: (v: number) => void;
}) {
  if (!result.sheets?.length) return null;
  return (
    <div className="row">
      <Field label="Sheet" hint="A workbook whose first tab is a cover page is the normal case.">
        <Select value={sheet || result.sheet || ""} onChange={(e) => onSheet(e.target.value)}>
          {result.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </Field>
      <Field label="Headings are on row" hint="Counted as the spreadsheet counts: the first row is 1.">
        <Input
          numeric
          value={(headerRow ?? result.headerRow ?? 0) + 1}
          onChange={(e) => onHeaderRow(Math.max(0, (Number(e.target.value) || 1) - 1))}
        />
      </Field>
    </div>
  );
}

function MappingFields({
  headers, mapping, onChange,
}: {
  headers: string[];
  mapping: ColumnMapping;
  onChange: (next: ColumnMapping) => void;
}) {
  const set = (field: string, value: string) => {
    const next = { ...mapping };
    if (value === "") delete next[field];
    else next[field] = Number(value);
    onChange(next);
  };

  return (
    <div className="stack">
      {Object.keys(FIELD_LABELS).map((field) => (
        <Field
          key={field}
          label={FIELD_LABELS[field]}
          hint={field === "sku" || field === "productName" || field === "resellerPrice" ? "Required" : "Optional"}
        >
          <Select value={mapping[field] === undefined ? "" : String(mapping[field])} onChange={(e) => set(field, e.target.value)}>
            <option value="">— not in this file —</option>
            {headers.map((h, i) => (
              <option key={`${h}-${i}`} value={i}>{h || `Column ${i + 1}`}</option>
            ))}
          </Select>
        </Field>
      ))}
      <p className="field-hint">
        Saved with the list, so next month's file for this OEM is read the same way without asking.
      </p>
    </div>
  );
}

function Changes({ result, oem }: { result: UploadResult; oem: string }) {
  const changes = result.changes ?? [];
  if (result.changesUnavailable) {
    return <div className="notice"><span>The comparison against the live list is not available to you.</span></div>;
  }
  if (!changes.length) {
    return (
      <div className="notice">
        <span>
          Nothing to compare against — there is no live {oem} list yet, so every one of these products is new.
        </span>
      </div>
    );
  }

  const added = changes.filter((c) => c.change === "added");
  const removed = changes.filter((c) => c.change === "removed");
  const moved = changes.filter((c) => c.change === "changed");
  const biggest = [...moved].sort((a, b) => Math.abs(b.change_pct ?? 0) - Math.abs(a.change_pct ?? 0)).slice(0, 10);

  return (
    <div className="stack">
      <div className="row">
        <Chip tone="good">{added.length} new</Chip>
        <Chip tone="neutral">{removed.length} gone</Chip>
        <Chip tone={moved.length ? "warn" : "neutral"}>{moved.length} changed price</Chip>
      </div>
      {biggest.length ? (
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Biggest price moves</th>
              <th className="num">Was</th>
              <th className="num">Now</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {biggest.map((c) => (
              <tr key={`${c.sku}-${c.change_pct}`}>
                <td data-label="Product">
                  <div className="strong">{c.product_name || c.sku}</div>
                  <div className="muted mono">{c.sku}</div>
                </td>
                <td data-label="Was" className="num">{c.was === null ? "—" : inr(c.was)}</td>
                <td data-label="Now" className="num">{c.now_is === null ? "—" : inr(c.now_is)}</td>
                <td data-label="Change" className="num">
                  <Chip tone={(c.change_pct ?? 0) > 0 ? "warn" : "good"}>
                    {c.change_pct === null ? "—" : `${c.change_pct > 0 ? "+" : ""}${c.change_pct}%`}
                  </Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
      {moved.some((c) => Math.abs(c.change_pct ?? 0) > 50) ? (
        <div className="notice notice-warn">
          <span>
            Some prices have moved by more than half. That is usually the wrong column mapped rather than
            the distributor's doing — worth checking before loading.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Preview({ result }: { result: UploadResult }) {
  const items = result.items ?? [];
  if (!items.length) return null;
  return (
    <div className="table-wrap">
    <table className="table">
      <thead>
        <tr>
          <th>Product</th>
          <th>SKU</th>
          <th>Term</th>
          <th className="num">Reseller price</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={`${i.row}-${i.sku}`}>
            <td data-label="Product" className="strong">{i.productName}</td>
            <td data-label="SKU" className="mono">{i.sku}</td>
            <td data-label="Term">{[i.licenceType, i.unit].filter(Boolean).join(" / ") || "—"}</td>
            <td data-label="Reseller price" className="num">
              {i.currency === "INR" ? inr(i.resellerPrice) : `${i.currency} ${i.resellerPrice.toFixed(2)}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

function Problems({ result }: { result: UploadResult }) {
  const errors = result.errors ?? [];
  if (!errors.length) return null;
  return (
    <details className="stack">
      <summary>{errors.length} rows that cannot be read</summary>
      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Row</th>
            <th>SKU</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((e) => (
            <tr key={`${e.row}-${e.sku}`}>
              <td data-label="Row" className="num">{e.row}</td>
              <td data-label="SKU" className="mono">{e.sku || "—"}</td>
              <td data-label="Why">{e.problem}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </details>
  );
}
