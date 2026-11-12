import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Field, Input, Select, Tabs } from "../../components/primitives";
import { Confirm } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { inr } from "../../domain/currency/format";
import type { Role } from "../../domain/analytics/scope";
import {
  activatePriceList,
  deleteMarginRule,
  marginRules,
  priceListHistory,
  saveMarginRule,
  searchPriceBook,
  type MarginRuleRow,
  type PriceBookHit,
  type PriceListRow,
} from "../../data/priceBook";
import { marginReadings, minSellingPrice } from "../../domain/priceBook/pricing";
import { UploadDialog } from "./UploadDialog";

/**
 * The price book: what may be quoted, and the lowest it may be quoted at.
 *
 * THE SAME SCREEN FOR EVERYONE, with tabs that differ. A salesperson gets
 * Browse — product, SKU, licence term and the minimum selling price — and
 * that is the whole of what the server will give them: the tabs they do not
 * see are not tabs with the cost hidden, they are tabs whose data the
 * database refuses to send them. Hiding them is a courtesy, not the
 * control. See supabase/056_price_book.sql and its proof.
 *
 * ADMIN loads the month's list and sets the minimum margins. MANAGER sees
 * the cost picture and the margins but cannot change them, and cannot
 * approve a discount — that is in the policies, not in which buttons are
 * drawn here.
 */

/** The five TechZoid resells, with room for the sixth. */
export const PRICE_BOOK_OEMS = ["Microsoft", "Adobe", "Autodesk", "Kaspersky", "Other"] as const;

type Tab = "browse" | "lists" | "margins";

export function PriceBookScreen({
  company,
  role,
}: {
  company: string;
  role: Role;
}) {
  const privileged = role === "Admin" || role === "Manager";
  const isAdmin = role === "Admin";

  const tabs = useMemo(
    () => [
      { id: "browse" as Tab, label: "Browse" },
      ...(privileged ? [{ id: "lists" as Tab, label: "Monthly lists" }] : []),
      ...(privileged ? [{ id: "margins" as Tab, label: "Minimum margins" }] : []),
    ],
    [privileged],
  );
  const [tab, setTab] = useState<Tab>("browse");

  return (
    <>
      <PageHead
        title="Price book"
        sub={
          privileged
            ? "The month's OEM reseller lists, the minimum margin on each, and the floor every quotation is held to."
            : "Everything you can quote, and the lowest price you may quote it at."
        }
      />
      {tabs.length > 1 ? <Tabs tabs={tabs} active={tab} onChange={setTab} /> : null}

      {tab === "browse" ? (
        <BrowseTab company={company} />
      ) : tab === "lists" ? (
        <ListsTab company={company} isAdmin={isAdmin} />
      ) : (
        <MarginsTab company={company} isAdmin={isAdmin} />
      )}
    </>
  );
}

/* ── browse ─────────────────────────────────────────────────────────── */

function BrowseTab({ company }: { company: string }) {
  const [query, setQuery] = useState("");
  const [oem, setOem] = useState("");
  const [hits, setHits] = useState<PriceBookHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setHits(await searchPriceBook(company, query, oem || null, 200));
      setSearched(true);
    } catch (e) {
      setError((e as Error)?.message || "The price book could not be searched.");
    }
    setBusy(false);
  }, [company, query, oem]);

  /* Load the first page on arrival, so an empty price book says so rather
     than looking like a search nobody has run yet. */
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  return (
    <div className="stack">
      <Card>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <Field label="Search">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Part number or product name"
            />
          </Field>
          <Field label="OEM">
            <Select value={oem} onChange={(e) => setOem(e.target.value)}>
              <option value="">All</option>
              {PRICE_BOOK_OEMS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          </Field>
          <Button type="submit" tone="primary" loading={busy} loadingLabel="Searching…">Search</Button>
        </form>
        <p className="field-hint">
          The minimum selling price is the floor. Quote above it freely; below it needs an Admin's
          approval, which you can ask for from the quotation itself.
        </p>
      </Card>

      {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

      {!hits.length && searched && !busy ? (
        <Empty
          title="Nothing in the price book yet"
          body={
            query || oem
              ? "No product matched. Try a part number, or clear the OEM filter."
              : "An Admin loads each OEM's monthly reseller list, and the products appear here with the lowest price you may quote."
          }
        />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Licence term</th>
                  <th className="num">Minimum selling price</th>
                  <th>Price list</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={h.itemId}>
                    <td data-label="Product">
                      <div className="strong">{h.productName}</div>
                      <div className="muted">{[h.oem, h.category].filter(Boolean).join(" · ")}</div>
                    </td>
                    <td data-label="SKU" className="mono">{h.sku}</td>
                    <td data-label="Licence term">{[h.licenceType, h.unit].filter(Boolean).join(" / ") || "—"}</td>
                    <td data-label="Minimum selling price" className="num strong">
                      {h.currency === "INR" ? inr(h.minPrice) : `${h.currency} ${h.minPrice.toFixed(2)}`}
                    </td>
                    <td data-label="Price list"><span className="muted">{h.period}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

    </div>
  );
}

/* ── the monthly lists ──────────────────────────────────────────────── */

function ListsTab({ company, isAdmin }: { company: string; isAdmin: boolean }) {
  const toast = useToast();
  const [lists, setLists] = useState<PriceListRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [activating, setActivating] = useState<PriceListRow | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setLists(await priceListHistory(company));
    } catch (e) {
      setError((e as Error)?.message || "The price lists could not be read.");
    }
    setBusy(false);
  }, [company]);

  useEffect(() => {
    void load();
  }, [load]);

  const byOem = useMemo(() => {
    const groups = new Map<string, PriceListRow[]>();
    for (const row of lists) {
      const key = row.oem || "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [lists]);

  const activate = async () => {
    if (!activating) return;
    try {
      await activatePriceList(activating.id);
      toast(`${activating.oem} ${activating.period} is now the live list`, "good");
      setActivating(null);
      await load();
    } catch (e) {
      toast((e as Error)?.message || "That list could not be made active", "bad");
      setActivating(null);
    }
  };

  return (
    <div className="stack">
      {isAdmin ? (
        <Card
          title="This month's lists"
          actions={<Button tone="primary" onClick={() => setUploading(true)}>Load a price list</Button>}
        >
          <p className="field-hint">
            One .xlsx per OEM per month. The file is read on the server, you see what it found before
            anything is saved, and the column mapping is remembered so next month is one click.
          </p>
        </Card>
      ) : (
        <div className="notice">
          <span>
            You can see every month on file and the cost behind it. Loading a new list is an Admin's job.
          </span>
        </div>
      )}

      {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

      {!lists.length && !busy ? (
        <Empty
          title="No price lists yet"
          body="Load an OEM's monthly reseller list and every SKU in it becomes quotable, with a minimum selling price worked out from the minimum margin."
        />
      ) : null}

      {byOem.map(([oem, months]) => (
        <Card key={oem} title={oem} padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>State</th>
                  <th className="num">Products</th>
                  <th>File</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.id}>
                    <td data-label="Month" className="strong">{m.period}</td>
                    <td data-label="State">
                      <Chip tone={m.status === "active" ? "good" : m.status === "draft" ? "warn" : "neutral"}>
                        {m.status === "active" ? "Live" : m.status === "draft" ? "Not live yet" : "Archived"}
                      </Chip>
                    </td>
                    <td data-label="Products" className="num">{m.rowCount}</td>
                    <td data-label="File"><span className="muted">{m.sourceName ?? "—"}</span></td>
                    <td className="row-tight">
                      {isAdmin && m.status !== "active" ? (
                        <Button tone="quiet" onClick={() => setActivating(m)}>Make this the live list</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {uploading ? (
        <UploadDialog
          company={company}
          onClose={() => setUploading(false)}
          onLoaded={() => {
            setUploading(false);
            void load();
          }}
        />
      ) : null}

      <Confirm
        open={!!activating}
        title={activating ? `Make ${activating.oem} ${activating.period} the live list?` : ""}
        body={
          <div className="stack">
            <p>
              Every new quotation will be priced from this list, and the month it replaces will be archived.
            </p>
            <p className="field-hint">
              Quotations already raised keep the prices they were quoted at. Nothing already sent changes.
            </p>
          </div>
        }
        confirmLabel="Make it live"
        onConfirm={() => void activate()}
        onCancel={() => setActivating(null)}
      />
    </div>
  );
}

/* ── the minimum margins ────────────────────────────────────────────── */

const BLANK_RULE = { id: "", oem: "*", category: "", sku: "", minMarginPct: "" };

function MarginsTab({ company, isAdmin }: { company: string; isAdmin: boolean }) {
  const toast = useToast();
  const [rules, setRules] = useState<MarginRuleRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<typeof BLANK_RULE | null>(null);
  const [removing, setRemoving] = useState<MarginRuleRow | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setRules(await marginRules(company));
    } catch (e) {
      setError((e as Error)?.message || "The minimum margins could not be read.");
    }
    setBusy(false);
  }, [company]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!editing) return;
    const pct = Number(editing.minMarginPct);
    if (!Number.isFinite(pct) || pct < 0) {
      toast("A minimum margin is a percentage, zero or more", "bad");
      return;
    }
    try {
      await saveMarginRule({
        id: editing.id || undefined,
        company,
        oem: editing.oem,
        category: editing.category,
        sku: editing.sku,
        minMarginPct: pct,
      });
      toast("Minimum margin saved", "good");
      setEditing(null);
      await load();
    } catch (e) {
      toast((e as Error)?.message || "That rule could not be saved", "bad");
    }
  };

  const remove = async () => {
    if (!removing) return;
    try {
      await deleteMarginRule(removing.id);
      toast("Rule removed", "good");
      setRemoving(null);
      await load();
    } catch (e) {
      toast((e as Error)?.message || "That rule could not be removed", "bad");
      setRemoving(null);
    }
  };

  const example = Number(editing?.minMarginPct);

  return (
    <div className="stack">
      <Card
        title="Minimum margin"
        actions={isAdmin ? <Button tone="primary" onClick={() => setEditing({ ...BLANK_RULE })}>Add a rule</Button> : undefined}
      >
        <p className="field-hint">
          The minimum selling price is the reseller price plus this percentage, with no distributor discount
          assumed — so a discount you negotiate afterwards is margin earned, not margin already spent.
          The most specific rule wins: a SKU beats its category, a category beats its OEM, and the OEM
          beats the company default.
        </p>
        <div className="notice">
          <span>
            With no rule at all the floor is the reseller price itself — zero margin. That is deliberate:
            an unconfigured workspace cannot let anybody quote under cost, it just lets them quote at cost.
          </span>
        </div>
      </Card>

      {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

      {!rules.length && !busy ? (
        <Empty
          title="No minimum margins set"
          body="Until one is added, every product's floor is its reseller price. Start with a company default, then add exceptions per OEM, category or SKU."
          action={isAdmin ? <Button tone="primary" onClick={() => setEditing({ ...BLANK_RULE })}>Add a rule</Button> : undefined}
        />
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Applies to</th>
                  <th className="num">Minimum margin</th>
                  <th className="num">₹1,000 becomes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Applies to">
                      <div className="strong">{r.oem === "*" ? "Every OEM (company default)" : r.oem}</div>
                      <div className="muted">
                        {r.sku ? `SKU ${r.sku}` : r.category ? `Category ${r.category}` : "All products"}
                      </div>
                    </td>
                    <td data-label="Minimum margin" className="num">{r.minMarginPct}%</td>
                    <td data-label="₹1,000 becomes" className="num">
                      {inr(minSellingPrice(1000, r.minMarginPct))}
                      <div className="muted">
                        {marginReadings(minSellingPrice(1000, r.minMarginPct), 1000).grossMarginPct}% of the sale
                      </div>
                    </td>
                    <td className="row-tight">
                    {isAdmin ? (
                      <>
                        <Button
                          tone="quiet"
                          onClick={() =>
                            setEditing({
                              id: r.id,
                              oem: r.oem,
                              category: r.category ?? "",
                              sku: r.sku ?? "",
                              minMarginPct: String(r.minMarginPct),
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button tone="quiet" onClick={() => setRemoving(r)}>Remove</Button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {editing ? (
        <Confirm
          open
          title={editing.id ? "Edit the minimum margin" : "Add a minimum margin"}
          body={
            <div className="stack">
              <Field label="OEM" hint="Leave as the default to set one figure for every OEM.">
                <Input
                  list="price-book-oems"
                  value={editing.oem}
                  onChange={(e) => setEditing({ ...editing, oem: e.target.value })}
                  placeholder="Microsoft"
                />
                <datalist id="price-book-oems">
                  <option value="*" />
                  {PRICE_BOOK_OEMS.map((o) => <option key={o} value={o} />)}
                </datalist>
              </Field>
              <Field label="Category" hint="Optional. Blank means every category of that OEM.">
                <Input value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })} placeholder="Cloud" />
              </Field>
              <Field label="SKU" hint="Optional. Blank means every SKU in that category.">
                <Input value={editing.sku} onChange={(e) => setEditing({ ...editing, sku: e.target.value })} placeholder="M365-E3" />
              </Field>
              <Field label="Minimum margin %">
                <Input
                  numeric
                  value={editing.minMarginPct}
                  onChange={(e) => setEditing({ ...editing, minMarginPct: e.target.value })}
                  placeholder="15"
                />
              </Field>
              {Number.isFinite(example) && example > 0 ? (
                <div className="notice">
                  <span>
                    A product the distributor lists at ₹1,000 could not be quoted below{" "}
                    <strong>{inr(minSellingPrice(1000, example))}</strong> — {example}% over the reseller price,
                    which is {marginReadings(minSellingPrice(1000, example), 1000).grossMarginPct}% of the sale.
                    Both figures are the same deal; the CRM's other margin numbers use the second.
                  </span>
                </div>
              ) : null}
            </div>
          }
          confirmLabel={editing.id ? "Save" : "Add"}
          onConfirm={() => void save()}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      <Confirm
        open={!!removing}
        title="Remove this minimum margin?"
        body={
          <p>
            {removing?.sku || removing?.category
              ? "Products it covered fall back to the next rule up — the category, the OEM, then the company default."
              : "Every product it covered falls back to the next rule up, and with none the floor becomes the reseller price itself."}
          </p>
        }
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
