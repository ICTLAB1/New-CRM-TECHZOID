import { applyCustomer, blankItem, newQuotation, type DocSettings, type SalesDocument } from "../documents/create";
import { addDays, TODAY } from "../dates";
import type { Customer } from "../customers/customer";
import type { CatalogProduct } from "../catalog/types";
import type { LineItem } from "../tax/types";

/**
 * Turning "quote ACME 10 x M365 Business Standard at 1,200" into a draft.
 *
 * WHAT THIS DOES NOT DO: save anything, create a customer, or send. It
 * returns a document for the editor to open, exactly as the "new quotation"
 * button does. That is deliberate and not timidity — a quantity or a rate
 * read wrongly out of a sentence becomes a price promise the moment the
 * document leaves the building, and there is no recalling it. The invoice
 * reader in this codebase already works this way: extract, prefill, let a
 * person look. The typing is what was slow; the looking was never the slow
 * part.
 *
 * The language model's job ends at the boundary of this file. It reads
 * English and returns fields; everything about what a quotation IS — which
 * customer, which SKU, what tax, what the margin is worked out from — is
 * decided here, against the catalog and the customer list, where it can be
 * tested. A model that invents an HSN code is a model that files a wrong
 * tax return.
 */

/** What the model is asked to pull out of the sentence. Nothing here is
 *  trusted as an identifier — names are matched locally, below. */
export interface ExtractedQuote {
  customer?: {
    company?: string;
    contact?: string;
    email?: string;
    phone?: string;
    gstin?: string;
    state?: string;
  };
  items?: {
    desc?: string;
    qty?: number;
    rate?: number;
    unit?: string;
    discPercent?: number;
    taxPercent?: number;
  }[];
  currency?: string;
  validityDays?: number;
  notes?: string;
}

/** What was understood, so the screen can say so before anybody sends it. */
export interface DraftReport {
  /** The customer this was matched to, or null when nothing matched. */
  matchedCustomer: Customer | null;
  /** Set when a company was named but no record matched it. */
  unmatchedCustomerName: string;
  lines: {
    desc: string;
    /** The catalog product this line was matched to, if any. */
    matchedProduct: CatalogProduct | null;
    /** True when the price came from the sentence rather than the catalog. */
    priceFromText: boolean;
    /** Set when neither the sentence nor the catalog gave a price. */
    needsPrice: boolean;
  }[];
}

const norm = (v: unknown): string =>
  String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A number, or undefined when there wasn't one.
 *
 * The `undefined` matters more than the number. This first returned 0 for a
 * missing value, because `Number("")` is 0 and 0 is finite — so a line whose
 * price nobody stated came out priced at zero instead of being flagged as
 * needing one, and a quotation that gives the goods away looks exactly like
 * a quotation that does not. Absent is not zero.
 */
const num = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const text = String(v ?? "").replace(/[,\s₹$]/g, "");
  if (text === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * The customer this sentence is about.
 *
 * Exact normalised name first, then a containment match, because people
 * write "ACME" for "ACME Infotech Private Limited" and expect it to land.
 * A containment match is only accepted when exactly ONE customer matches:
 * quoting the wrong company is worse than asking which one.
 */
export function matchCustomer(name: string, customers: readonly Customer[]): Customer | null {
  const wanted = norm(name);
  if (!wanted) return null;

  const exact = customers.filter((c) => norm(c.company) === wanted);
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;

  const partial = customers.filter((c) => {
    const have = norm(c.company);
    return have.length > 0 && (have.includes(wanted) || wanted.includes(have));
  });
  return partial.length === 1 ? (partial[0] ?? null) : null;
}

/**
 * The catalog product a line is about.
 *
 * Same rule as the customer, and for the same reason: one match or none.
 * An SKU written out wins over a name, since that is the unambiguous thing.
 */
export function matchProduct(desc: string, catalog: readonly CatalogProduct[]): CatalogProduct | null {
  const wanted = norm(desc);
  if (!wanted) return null;
  const active = catalog.filter((p) => p.active !== false);

  const bySku = active.filter((p) => norm(p.skuId) === wanted || norm(p.productId) === wanted);
  if (bySku.length === 1) return bySku[0] ?? null;

  const exact = active.filter((p) => norm(p.name) === wanted);
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;

  const partial = active.filter((p) => {
    const have = norm(p.name);
    return have.length > 0 && (have.includes(wanted) || wanted.includes(have));
  });
  return partial.length === 1 ? (partial[0] ?? null) : null;
}

/**
 * Build the draft.
 *
 * @param extracted what the model read out of the sentence
 * @param ctx the workspace it is being read against
 */
export function draftFromText(
  extracted: ExtractedQuote,
  ctx: {
    settings: DocSettings & Record<string, unknown>;
    user: { id: string; name: string };
    customers: readonly Customer[];
    catalog: readonly CatalogProduct[];
    today?: string;
  },
): { doc: SalesDocument; report: DraftReport } {
  const { settings, user, customers, catalog, today } = ctx;

  const named = String(extracted.customer?.company ?? "").trim();
  const matchedCustomer = named ? matchCustomer(named, customers) : null;

  let doc = newQuotation({ settings, user, customer: matchedCustomer, today });

  /* A matched customer brings its own billing block, tax type and terms —
     the same path the picker in the editor uses, so a quotation raised this
     way is indistinguishable from one raised by hand. */
  if (matchedCustomer) doc = applyCustomer(doc, matchedCustomer, settings);
  else if (named) {
    /* Nothing matched: fill what was dictated so the person can see it and
       decide, rather than silently filing a new customer record from a
       sentence that might have a typo in the company name. */
    doc = {
      ...doc,
      billName: named,
      billContact: String(extracted.customer?.contact ?? ""),
      billEmail: String(extracted.customer?.email ?? ""),
      billPhone: String(extracted.customer?.phone ?? ""),
      billGstin: String(extracted.customer?.gstin ?? ""),
      billState: String(extracted.customer?.state ?? doc.billState ?? ""),
    } as SalesDocument;
  }

  const defaultTax = num(settings.defaultGst) ?? 18;
  const lines: DraftReport["lines"] = [];

  const items: LineItem[] = (extracted.items ?? []).map((raw) => {
    const desc = String(raw.desc ?? "").trim();
    const product = desc ? matchProduct(desc, catalog) : null;

    const spokenRate = num(raw.rate);
    /* A price said out loud beats the catalog's. The person dictating knows
       what they negotiated; the catalog knows the list. */
    const rate = spokenRate ?? (product ? num(product.sellPrice) : undefined);

    const item: LineItem = {
      ...blankItem(defaultTax),
      desc: product?.name || desc,
      qty: num(raw.qty) ?? 1,
      rate: rate ?? "",
      unit: String(raw.unit ?? product?.unit ?? "Nos"),
      disc: num(raw.discPercent) ?? 0,
      gst: num(raw.taxPercent) ?? defaultTax,
    };

    /* From the catalog and never from the sentence: an SKU, an HSN code and
       a cost price are facts about a product, not things to infer from
       English. `cost` is what every margin figure is worked out from, so a
       guessed one would quietly misreport profit on the whole deal. */
    if (product) {
      item.sku = product.skuId || product.productId || "";
      item.hsn = product.hsn || "";
      item.brand = product.publisher || "";
      const cost = num(product.costPrice);
      if (cost !== undefined) item.cost = cost;
    }

    lines.push({
      desc: item.desc ?? "",
      matchedProduct: product,
      priceFromText: spokenRate !== undefined,
      needsPrice: rate === undefined,
    });
    return item;
  });

  if (items.length) doc = { ...doc, items };

  /* "valid for 30 days" was being read and then dropped on the floor: the
     tool returned it, nothing consumed it, and the quotation silently kept
     the workspace default. Found by checking every field the model may
     return against the fields this function actually uses. */
  const validity = num(extracted.validityDays);
  if (validity !== undefined && validity > 0) {
    doc = { ...doc, validUntil: addDays(today ?? TODAY(), Math.round(validity)) };
  }
  const currency = String(extracted.currency ?? "").trim().toUpperCase();
  if (currency) doc = { ...doc, currency };
  if (extracted.notes) doc = { ...doc, notes: String(extracted.notes) } as SalesDocument;

  return {
    doc,
    report: {
      matchedCustomer,
      unmatchedCustomerName: matchedCustomer ? "" : named,
      lines,
    },
  };
}
