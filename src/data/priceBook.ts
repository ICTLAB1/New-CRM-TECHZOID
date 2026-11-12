import { getDb, hasBackend } from "./backend";
import { fnPath, fnToken } from "./functions";

/**
 * The price book, as the browser is allowed to see it.
 *
 * WHAT IS NOT IN THIS FILE, and cannot be: the reseller price, the buying
 * price, the distributor discount and the margin. For a Sales user those
 * are not hidden here — they never arrive. `price_book_search` has no cost
 * column in its return type at all, and the table that holds the cost
 * admits only Admin and Manager (supabase/056_price_book.sql). This module
 * reads what those functions return and renames the columns; it has no
 * opinion about who may see what, because that decision is not the
 * browser's to make.
 *
 * The one call that does carry cost is `searchWithCost`, and it is for the
 * approvals screen. It raises for anybody who may not have it, which is
 * why the error is shown rather than swallowed: a Manager seeing "cost
 * prices are for Admin and Manager only" has learned something true, and a
 * silent empty list would have told them the price book was empty.
 */

export interface PriceBookHit {
  itemId: string;
  oem: string;
  sku: string;
  productName: string;
  category: string | null;
  licenceType: string | null;
  unit: string | null;
  currency: string;
  /** The lowest price this person may quote. The only price they get. */
  minPrice: number;
  /** 'YYYY-MM' — which month's list this came from. */
  period: string;
}

/** The same with the cost picture, for Admin and Manager only. */
export interface CostedHit extends PriceBookHit {
  resellerPrice: number;
  buyingPrice: number;
  minMarginPct: number;
}

export interface PriceListRow {
  id: string;
  oem: string;
  period: string;
  status: "draft" | "active" | "archived";
  rowCount: number;
  sourceName: string | null;
  activatedAt: string | null;
  createdAt: string | null;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const text = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const orNull = (v: unknown): string | null => {
  const s = text(v).trim();
  return s ? s : null;
};

/** One row of price_book_search, renamed. Exported for its own test. */
export function toHit(row: Record<string, unknown>): PriceBookHit {
  return {
    itemId: text(row.item_id),
    oem: text(row.oem),
    sku: text(row.sku),
    productName: text(row.product_name),
    category: orNull(row.category),
    licenceType: orNull(row.licence_type),
    unit: orNull(row.unit),
    currency: text(row.currency) || "INR",
    minPrice: num(row.min_price),
    period: text(row.period),
  };
}

export function toCostedHit(row: Record<string, unknown>): CostedHit {
  return {
    ...toHit(row),
    resellerPrice: num(row.reseller_price),
    buyingPrice: num(row.buying_price),
    minMarginPct: num(row.min_margin_pct),
  };
}

export function toListRow(row: Record<string, unknown>): PriceListRow {
  const status = text(row.status);
  return {
    id: text(row.id),
    oem: text(row.oem),
    period: text(row.period),
    status: status === "active" || status === "archived" ? status : "draft",
    rowCount: num(row.row_count),
    sourceName: orNull(row.source_name),
    activatedAt: orNull(row.activated_at),
    createdAt: orNull(row.created_at),
  };
}

const rows = (data: unknown): Record<string, unknown>[] =>
  Array.isArray(data) ? (data as Record<string, unknown>[]) : [];

/**
 * Search the active price lists.
 *
 * Returns [] when there is no backend — the preview build has none — rather
 * than throwing, because a picker that cannot search should be empty, not
 * broken.
 */
export async function searchPriceBook(
  company: string,
  query: string,
  oem?: string | null,
  limit = 50,
): Promise<PriceBookHit[]> {
  if (!hasBackend() || !company) return [];
  const { data, error } = await getDb().rpc("price_book_search", {
    p_company: company,
    p_query: query?.trim() ? query.trim() : null,
    p_oem: oem?.trim() ? oem.trim() : null,
    p_limit: limit,
  });
  if (error) throw new Error(error.message ?? "The price book could not be searched.");
  return rows(data).map(toHit);
}

/** The same search with cost, for Admin and Manager. Throws for anybody else. */
export async function searchWithCost(
  company: string,
  query: string,
  oem: string | null,
  distributorDiscountPct: number,
  limit = 50,
): Promise<CostedHit[]> {
  if (!hasBackend() || !company) return [];
  const { data, error } = await getDb().rpc("price_book_search_costed", {
    p_company: company,
    p_query: query?.trim() ? query.trim() : null,
    p_oem: oem?.trim() ? oem.trim() : null,
    p_limit: limit,
    p_distributor_pct: Number.isFinite(distributorDiscountPct) ? distributorDiscountPct : 0,
  });
  if (error) throw new Error(error.message ?? "The cost picture could not be read.");
  return rows(data).map(toCostedHit);
}

/**
 * The minimum selling price for items already on a quotation, keyed by item
 * id.
 *
 * WHY A QUOTATION ASKS AGAIN RATHER THAN TRUSTING WHAT IT SAVED. A
 * quotation holds the minimum it was built with, which is right for
 * showing what was quoted — but the question "may this be sent" has to be
 * answered against the list in force now. A quotation built in November
 * and edited in December is being priced against December.
 */
export async function minimumsFor(
  company: string,
  itemIds: readonly string[],
): Promise<Map<string, { minPrice: number; currency: string; period: string; sku: string }>> {
  const out = new Map<string, { minPrice: number; currency: string; period: string; sku: string }>();
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (!hasBackend() || !company || !ids.length) return out;

  const { data, error } = await getDb().rpc("price_book_minimums", {
    p_company: company,
    p_item_ids: ids,
  });
  if (error) throw new Error(error.message ?? "The minimum prices could not be read.");
  for (const row of rows(data)) {
    out.set(text(row.item_id), {
      minPrice: num(row.min_price),
      currency: text(row.currency) || "INR",
      period: text(row.period),
      sku: text(row.sku),
    });
  }
  return out;
}

/** Every month on file, newest first. No cost in any of it. */
export async function priceListHistory(company: string, oem?: string | null): Promise<PriceListRow[]> {
  if (!hasBackend() || !company) return [];
  const { data, error } = await getDb().rpc("price_list_history", {
    p_company: company,
    p_oem: oem?.trim() ? oem.trim() : null,
  });
  if (error) throw new Error(error.message ?? "The price list history could not be read.");
  return rows(data).map(toListRow);
}

/** Make one month the live list for its OEM. Admin only, in the database. */
export async function activatePriceList(listId: string): Promise<void> {
  const { error } = await getDb().rpc("price_list_activate", { p_list: listId });
  if (error) throw new Error(error.message ?? "That list could not be made active.");
}

/* ── loading a month ─────────────────────────────────────────────────────
   The workbook goes to the server and is parsed there. The browser sends
   the file and renders the answer; it has no copy of the rules about what a
   price list row is. See api/lib/priceListSheet.mjs. */

export interface ColumnMapping {
  [field: string]: number;
}

export interface ParsedRow {
  sku: string;
  productName: string;
  category: string | null;
  licenceType: string | null;
  unit: string | null;
  resellerPrice: number;
  currency: string;
  row: number;
}

export interface RowProblem {
  row: number;
  sku: string;
  productName: string;
  problem: string;
}

export interface PriceChange {
  change: "added" | "removed" | "changed";
  sku: string;
  product_name: string;
  was: number | null;
  now_is: number | null;
  change_pct: number | null;
}

export interface UploadResult {
  /** mapping: say which column is which. preview: here is what I found.
   *  confirm: there are bad rows, say whether to go on. loaded: done. */
  stage: "mapping" | "preview" | "confirm" | "loaded";
  sheets?: string[];
  sheet?: string;
  headerRow?: number;
  headers?: string[];
  mapping?: ColumnMapping;
  /** Where the mapping came from: you, a past upload, or the headings. */
  mappingFrom?: string;
  missing?: string[];
  message?: string;
  itemCount?: number;
  errorCount?: number;
  truncated?: boolean;
  items?: ParsedRow[];
  errors?: RowProblem[];
  changes?: PriceChange[];
  changeCount?: number;
  changesUnavailable?: string | null;
  listId?: string | null;
  itemsLoaded?: number;
  replaced?: boolean;
  activated?: boolean;
}

export interface UploadRequest {
  company: string;
  oem: string;
  year: number;
  month: number;
  fileName: string;
  fileBase64: string;
  sheet?: string;
  headerRow?: number;
  mapping?: ColumnMapping;
  commit?: boolean;
  acceptErrors?: boolean;
  activate?: boolean;
}

/**
 * Send a workbook to be read, or to be loaded.
 *
 * The same call does both: without `commit` the answer is what the server
 * found, with it the rows are written. The file is re-sent on the commit
 * rather than held on the server between the two, so there is no
 * half-finished upload to expire, and the rows that get loaded are read
 * from the file the Admin is looking at.
 */
export async function uploadPriceList(req: UploadRequest): Promise<UploadResult> {
  if (!hasBackend()) throw new Error("Loading a price list needs the server. This preview has no backend.");
  const token = await fnToken();
  const resp = await fetch(fnPath("price-list-upload"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(req),
  });
  const body = (await resp.json().catch(() => ({}))) as UploadResult & { error?: string };

  /* 409 is not a failure: it is the server asking whether to go ahead with
     the rows it could read. */
  if (resp.status === 409 && body?.stage === "confirm") return body;
  if (!resp.ok) throw new Error(body?.error || `The server said ${resp.status}.`);
  return body;
}

/** A file as base64, without the data: prefix the reader puts on it. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.replace(/^data:[^,]*,/, ""));
    };
    reader.readAsDataURL(file);
  });
}

/* ── the minimum margins ─────────────────────────────────────────────────
   Rules are read and written through the ordinary table endpoint, because
   the policies on oem_margin_rules already say who may: Admin and Manager
   can read, only an Admin can write. A margin rule is a cost secret — it
   is the other half of the arithmetic — which is why a Sales user asking
   for these gets an empty list rather than a redacted one. */

export interface MarginRuleRow {
  id: string;
  companyId: string;
  /** '*' means the company-wide default. */
  oem: string;
  category: string | null;
  sku: string | null;
  minMarginPct: number;
  updatedAt: string | null;
}

export function toMarginRule(row: Record<string, unknown>): MarginRuleRow {
  return {
    id: text(row.id),
    companyId: text(row.company_id),
    oem: text(row.oem),
    category: orNull(row.category),
    sku: orNull(row.sku),
    minMarginPct: num(row.min_margin_pct),
    updatedAt: orNull(row.updated_at),
  };
}

export async function marginRules(company: string): Promise<MarginRuleRow[]> {
  if (!hasBackend() || !company) return [];
  const { data, error } = await getDb()
    .from("oem_margin_rules")
    .select("id, company_id, oem, category, sku, min_margin_pct, updated_at")
    .eq("company_id", company);
  if (error) throw new Error(error.message ?? "The minimum margins could not be read.");
  /* Most specific first, which is the order they take effect in. */
  return rows(data)
    .map(toMarginRule)
    .sort((a, b) => rank(b) - rank(a) || a.oem.localeCompare(b.oem) || (a.category ?? "").localeCompare(b.category ?? ""));
}

const rank = (r: MarginRuleRow): number =>
  (r.sku ? 4 : 0) + (r.category ? 2 : 0) + (r.oem !== "*" ? 1 : 0);

export async function saveMarginRule(rule: {
  id?: string;
  company: string;
  oem: string;
  category?: string | null;
  sku?: string | null;
  minMarginPct: number;
}): Promise<void> {
  const row = {
    company_id: rule.company,
    oem: rule.oem.trim() || "*",
    category: rule.category?.trim() ? rule.category.trim() : null,
    sku: rule.sku?.trim() ? rule.sku.trim() : null,
    min_margin_pct: rule.minMarginPct,
    updated_at: new Date().toISOString(),
  };
  const db = getDb();
  const { error } = rule.id
    ? await db.from("oem_margin_rules").update(row).eq("id", rule.id)
    : await db.from("oem_margin_rules").insert(row);
  if (error) {
    /* The unique index is on (company, oem, category, sku), so the one
       collision worth naming is a rule that already exists. */
    const message = String(error.message ?? "");
    throw new Error(
      /duplicate key|unique/i.test(message)
        ? "There is already a rule for that OEM, category and SKU. Edit that one instead."
        : message || "That rule could not be saved.",
    );
  }
}

export async function deleteMarginRule(id: string): Promise<void> {
  const { error } = await getDb().from("oem_margin_rules").delete().eq("id", id);
  if (error) throw new Error(error.message ?? "That rule could not be removed.");
}

/* ── asking for a discount ───────────────────────────────────────────── */

export interface ApprovalLineAsk {
  lineId: string;
  itemId: string;
  qty: number;
  requestedPrice: number;
}

export interface MyApproval {
  id: string;
  quoteId: string;
  quoteNumber: string | null;
  reason: string;
  note: string | null;
  state: "pending" | "approved" | "rejected" | "withdrawn";
  lines: Array<{ lineId: string; sku: string; qty: number; minPrice: number; requestedPrice: number }>;
  approvedLines: Array<{ lineId: string; approvedPrice: number }>;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string | null;
}

export function toMyApproval(row: Record<string, unknown>): MyApproval {
  const state = text(row.state);
  return {
    id: text(row.id),
    quoteId: text(row.quote_id),
    quoteNumber: orNull(row.quote_number),
    reason: text(row.reason),
    note: orNull(row.note),
    state: state === "approved" || state === "rejected" || state === "withdrawn" ? state : "pending",
    lines: Array.isArray(row.lines) ? (row.lines as MyApproval["lines"]) : [],
    approvedLines: Array.isArray(row.approved_lines) ? (row.approved_lines as MyApproval["approvedLines"]) : [],
    decisionNote: orNull(row.decision_note),
    decidedAt: orNull(row.decided_at),
    createdAt: orNull(row.created_at),
  };
}

/**
 * Ask an Admin to approve a price below the floor.
 *
 * THE FLOOR IS NOT SENT. The lines carry which price book item, how many,
 * and what the salesperson wants to charge — the minimum is read from the
 * price book by the function itself. If the browser supplied it, a request
 * could be dressed up as a ₹10 discount on a product whose floor is ₹400
 * away, and the Admin would approve what they were shown.
 */
export async function requestApproval(req: {
  company: string;
  quoteId: string;
  quoteNumber?: string | null;
  reason: string;
  note?: string | null;
  lines: readonly ApprovalLineAsk[];
}): Promise<string> {
  const { data, error } = await getDb().rpc("request_discount_approval", {
    p_company: req.company,
    p_quote_id: req.quoteId,
    p_quote_number: req.quoteNumber ?? null,
    p_reason: req.reason,
    p_note: req.note ?? null,
    p_lines: req.lines.map((l) => ({
      lineId: l.lineId,
      itemId: l.itemId,
      qty: l.qty,
      requestedPrice: l.requestedPrice,
    })),
  });
  if (error) throw new Error(error.message ?? "That request could not be sent.");
  return text(data);
}

/** This salesperson's own requests, with the columns they may see. */
export async function myApprovals(company: string): Promise<MyApproval[]> {
  if (!hasBackend() || !company) return [];
  const { data, error } = await getDb().rpc("my_discount_approvals", { p_company: company });
  if (error) throw new Error(error.message ?? "Your approval requests could not be read.");
  return rows(data).map(toMyApproval);
}

export async function withdrawApproval(id: string): Promise<void> {
  const { error } = await getDb().rpc("withdraw_discount_approval", { p_approval: id });
  if (error) throw new Error(error.message ?? "That request could not be withdrawn.");
}

/* ── the approvals inbox ─────────────────────────────────────────────────
   Admin and Manager read discount_approvals directly: the policy admits
   them and nobody else, including the salesperson who raised the request,
   because the row carries the distributor discount. */

export interface ApprovalRow extends MyApproval {
  requestedBy: string;
  companyId: string;
  distributorDiscountPct: number | null;
  decidedBy: string | null;
}

export function toApprovalRow(row: Record<string, unknown>): ApprovalRow {
  return {
    ...toMyApproval(row),
    requestedBy: text(row.requested_by),
    companyId: text(row.company_id),
    distributorDiscountPct: row.distributor_discount_pct === null || row.distributor_discount_pct === undefined
      ? null
      : num(row.distributor_discount_pct),
    decidedBy: orNull(row.decided_by),
  };
}

const APPROVAL_COLUMNS =
  "id, company_id, quote_id, quote_number, requested_by, reason, note, state, lines, "
  + "approved_lines, decided_by, decided_at, decision_note, distributor_discount_pct, created_at";

/** Every request in a company, newest first. Empty for anyone not privileged. */
export async function approvalQueue(company: string, state?: "pending" | "all"): Promise<ApprovalRow[]> {
  if (!hasBackend() || !company) return [];
  let q = getDb().from("discount_approvals").select(APPROVAL_COLUMNS).eq("company_id", company);
  if (state !== "all") q = q.eq("state", "pending");
  const { data, error } = await q;
  if (error) throw new Error(error.message ?? "The approvals could not be read.");
  return rows(data)
    .map(toApprovalRow)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}

/** How many are waiting. For the badge; 0 for anyone who may not see them. */
export async function pendingApprovalCount(company: string): Promise<number> {
  try {
    return (await approvalQueue(company, "pending")).length;
  } catch {
    return 0;
  }
}

export interface ApprovalLine {
  lineId: string;
  sku: string;
  productName: string;
  qty: number;
  minPrice: number;
  requestedPrice: number;
  approvedPrice: number | null;
  resellerPrice: number | null;
  buyingPrice: number | null;
  /** Of the sale, which is what the CRM's other margin figures mean. */
  marginAtRequested: number | null;
  /** Over the buying price, which is what the minimum margin means. */
  markupAtRequested: number | null;
}

export function toApprovalLine(row: Record<string, unknown>): ApprovalLine {
  const maybe = (v: unknown): number | null => (v === null || v === undefined ? null : num(v));
  return {
    lineId: text(row.line_id),
    sku: text(row.sku),
    productName: text(row.product_name),
    qty: num(row.qty),
    minPrice: num(row.min_price),
    requestedPrice: num(row.requested_price),
    approvedPrice: maybe(row.approved_price),
    resellerPrice: maybe(row.reseller_price),
    buyingPrice: maybe(row.buying_price),
    marginAtRequested: maybe(row.margin_at_requested),
    markupAtRequested: maybe(row.markup_at_requested),
  };
}

/**
 * One request's lines with the cost behind them, at a given distributor
 * discount. Raises for anybody but Admin and Manager — including the
 * salesperson who asked, which is the point.
 */
export async function approvalLines(id: string, distributorPct: number): Promise<ApprovalLine[]> {
  const { data, error } = await getDb().rpc("approval_lines", {
    p_approval: id,
    p_distributor_pct: Number.isFinite(distributorPct) ? distributorPct : 0,
  });
  if (error) throw new Error(error.message ?? "The cost picture could not be read.");
  return rows(data).map(toApprovalLine);
}

/** Approve, counter or reject. Admin only, in the database. */
export async function decideApproval(req: {
  id: string;
  decision: "approved" | "rejected";
  lines?: Array<{ lineId: string; approvedPrice: number }>;
  distributorDiscountPct?: number | null;
  note?: string | null;
}): Promise<void> {
  const { error } = await getDb().rpc("decide_discount_approval", {
    p_approval: req.id,
    p_decision: req.decision,
    p_lines: req.lines ?? [],
    p_distributor_pct: req.distributorDiscountPct ?? null,
    p_note: req.note ?? null,
  });
  if (error) throw new Error(error.message ?? "That decision could not be saved.");
}

/**
 * Tell whoever should hear that a discount was asked for, or decided.
 *
 * THE BROWSER NAMES NOBODY. It sends the approval's id; the server works
 * out that a request goes to the company's Admins and a decision goes back
 * to the salesperson who asked. A browser that could name recipients could
 * email anyone from the company's mailbox.
 *
 * Returns how many went out. Never throws: the approval is recorded
 * whatever the mail does, and a company with no mailbox connected gets
 * zero and carries on.
 */
export async function notifyApproval(approvalId: string): Promise<{ sent: number; reason?: string }> {
  if (!hasBackend()) return { sent: 0, reason: "no backend" };
  try {
    const token = await fnToken();
    const resp = await fetch(fnPath("discount-approval-notify"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ approvalId }),
    });
    const body = (await resp.json().catch(() => ({}))) as { sent?: number; reason?: string; error?: string };
    if (!resp.ok) return { sent: 0, reason: body?.error || `the server said ${resp.status}` };
    return { sent: Number(body?.sent ?? 0), reason: body?.reason };
  } catch (e) {
    return { sent: 0, reason: (e as Error)?.message || "the notification could not be sent" };
  }
}
