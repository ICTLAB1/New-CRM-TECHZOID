import { getSupabase, isSupabaseConfigured } from "./supabase";
import { getActiveCompanyId } from "./store";
import { DEFAULT_PREFIX } from "../domain/numbering/docNumber";
import { OBJ_TYPE, OBJ_TYPE_OF_DOC_TYPE } from "../domain/documents/objType";
import type { DocType } from "../domain/documents/model";

/**
 * The next number in a document series, taken from the database.
 *
 * WHY NOT FROM SETTINGS, WHICH IS WHERE THE COUNTER LIVES. The browser used
 * to read `settings.quoteSeq`, use it, and write back seq + 1. That failed
 * in two ways at once, and the second one hid the first:
 *
 *   - `settings` is writable only by an admin or a manager, so a
 *     salesperson's write-back was rejected by row-level security. The
 *     rejection was swallowed, the counter never moved, and every quotation
 *     that salesperson raised came out with the same number.
 *   - Two people raising a quotation in the same minute both read the same
 *     counter and both used it.
 *
 * `public.next_doc_seq` (migration 018) does the read and the write in one
 * statement, as the database, so neither can happen. It is the same
 * arrangement as next_customer_code().
 *
 * THE NUMBER IS TAKEN WHEN A DOCUMENT IS SAVED, not when the editor opens.
 * Opening the editor and changing your mind must not leave a hole in the
 * series — a tax invoice series with holes is a question from an auditor.
 */

/** The counters. These strings are a contract with `next_doc_seq`, which
 *  whitelists them; another one needs the migration changed too. */
export type DocSeqKind = "quote" | "proforma" | "purchaseOrder" | "invoice" | "order" | "dispatch";

/** The settings key each counter is stored under. */
export const SEQ_KEY: Record<DocSeqKind, string> = {
  quote: "quoteSeq",
  proforma: "proformaSeq",
  purchaseOrder: "purchaseOrderSeq",
  invoice: "invoiceSeq",
  order: "orderSeq",
  dispatch: "dispatchSeq",
};

export const seqKindOf = (docType: string): DocSeqKind =>
  docType === "purchase_order" ? "purchaseOrder"
    : docType === "invoice" ? "invoice"
    : docType === "proforma" ? "proforma"
    : "quote";

/**
 * @param fallback the number to use when there is no database to ask — the
 * preview runs with no Supabase at all, and an older workspace may not have
 * migration 018 applied yet.
 * @returns the sequence number this document should carry. Never throws and
 * never returns null: a numbering hiccup must not be the reason somebody
 * loses a quotation they have just spent ten minutes on. Falling back to
 * the local counter is exactly the old behaviour, which is wrong under
 * contention but is not destructive.
 */
export async function nextDocSeq(kind: DocSeqKind, fallback: number): Promise<number> {
  const local = Math.max(1, Math.floor(Number(fallback) || 1));
  if (!isSupabaseConfigured()) return local;
  try {
    const { data, error } = await getSupabase().rpc("next_doc_seq", { p_kind: kind });
    if (error || data === null || data === undefined) {
      /* Worth knowing about: with a database present and this failing, the
         numbering is back to the browser's own counter and back to being
         wrong under contention. Usually means migration 018 has not been
         applied. Logged rather than shown — the save itself is fine. */
      console.error("next_doc_seq unavailable, falling back to the local counter:", error);
      return local;
    }
    const seq = Math.floor(Number(data));
    return Number.isFinite(seq) && seq > 0 ? seq : local;
  } catch {
    return local;
  }
}

/* ── numbering that restarts each financial year ───────────────────── */

/**
 * The next number in a series, for one document type in one financial year.
 *
 * WHAT THIS REPLACES AND WHY. `nextDocSeq` above draws from a single counter
 * per document kind that has never reset. The financial year is printed on
 * every document number, so on 1 April 2027 a quotation would come out as
 * TZ/QT/2027-28/0025 — a new year opening at twenty-five, the label and the
 * number disagreeing with each other. `public.next_doc_number` (migration
 * 032) keeps one counter per (type, year), so April starts at 0001.
 *
 * THE YEAR IS SENT, NOT INFERRED. This browser computes the financial year
 * it is about to print and asks for a number in that year. If the database
 * worked it out instead, a server on UTC and a person in India would
 * disagree for five and a half hours across the night of 31 March — the
 * label printed and the counter incremented would be for different years,
 * on the one night when that matters most.
 *
 * The fallback chain is deliberate: the new function, then the old one, then
 * the local counter. A numbering hiccup must never be the reason somebody
 * loses a document they have just spent ten minutes on.
 */
export async function nextDocNumber(
  objType: number,
  fy: string,
  kind: DocSeqKind,
  fallback: number,
): Promise<number> {
  const local = Math.max(1, Math.floor(Number(fallback) || 1));
  if (!isSupabaseConfigured()) return local;
  try {
    /* THE COMPANY ON SCREEN, not whichever one this person belongs to
       first. The two-argument form of next_doc_number falls back to
       default_company_id(), which is the oldest membership — so the second
       company's first quotation drew a number from the first company's
       series and came out as TZ/QT/2026-27/0027. It happened in the live
       workspace before this was fixed. */
    const company = getActiveCompanyId();
    const { data, error } = await getSupabase().rpc(
      "next_doc_number",
      company
        ? { p_company: company, p_obj_type: objType, p_fy: fy }
        : { p_obj_type: objType, p_fy: fy },
    );
    if (!error && data !== null && data !== undefined) {
      const seq = Math.floor(Number(data));
      if (Number.isFinite(seq) && seq > 0) return seq;
    }
    /* Migration 032 not applied yet — an older workspace, or a deployment
       that got ahead of the database. The old counter is wrong across an
       April boundary but is not destructive, which is the right way round. */
    console.error("next_doc_number unavailable, falling back to next_doc_seq:", error);
  } catch {
    /* fall through */
  }
  return nextDocSeq(kind, local);
}

/* ── which series a document type draws from ───────────────────────── */

export interface DocSeries {
  /** The SAP object type the database counter is keyed by. */
  objType: number;
  /** The legacy counter's kind, used only by the fallback path. */
  kind: DocSeqKind;
  /** Where this browser keeps its copy of that counter. */
  seqKey: string;
  /** What the number is printed with. */
  prefix: string;
}

/**
 * Everything needed to draw a number for one kind of document.
 *
 * WHY THIS IS A FUNCTION OF THE TYPE AND NOT OF THE SCREEN. The quotations
 * screen also raises documents of other types — a tax invoice and a
 * proforma are both started from a quotation — and it held the object type,
 * the counter key and the prefix as three constants fixed to its own
 * docType. Those two paths therefore had no series to draw from and drew
 * from none at all: an invoice raised from a quotation kept the preview
 * number its draft was built with, so every one of them came out as
 * INV/2026-27/0001. Three reached the live workspace carrying the same
 * number before it was noticed.
 *
 * A tax invoice series that repeats itself is not cosmetic: it is the
 * number a customer pays against and the number a GST return is filed
 * under. Keeping the mapping in one tested function is what stops a fourth
 * document type being added with no branch here.
 */
export function docSeries(docType: DocType, settings: Record<string, unknown>): DocSeries {
  const kind = seqKindOf(docType);
  const prefixKey = docType === "purchase_order" ? "purchaseOrderPrefix"
    : docType === "invoice" ? "invoicePrefix"
    : docType === "proforma" ? "proformaPrefix"
    : "quotePrefix";
  const fallback = docType === "purchase_order" ? DEFAULT_PREFIX.purchaseOrder
    : docType === "invoice" ? DEFAULT_PREFIX.invoice
    : docType === "proforma" ? DEFAULT_PREFIX.proforma
    : DEFAULT_PREFIX.quotation;
  return {
    objType: OBJ_TYPE_OF_DOC_TYPE[docType] ?? OBJ_TYPE.quotation,
    kind,
    seqKey: SEQ_KEY[kind],
    prefix: String(settings[prefixKey] ?? fallback),
  };
}
