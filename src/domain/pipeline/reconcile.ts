import { computeDocument } from "../tax/compute";
import { countsAsWon, wonAmount } from "./stages";

/**
 * Does the revenue a won deal is reported at match the paperwork behind it?
 *
 * WHY THIS EXISTS. Reported from a live workspace: "Total sales or closed
 * orders values are not getting matched with the order won or invoice."
 * They did not match, for a reason that was in the code — the figure
 * somebody typed on the customer when the lead was created took precedence
 * over the document the win was actually recorded on, so a deal won on a
 * ₹4,72,000 order was reported at whatever had been guessed in March. That
 * is fixed at the moment of the win (see wonValueFor and
 * StageChange.wonValue), but a fix to the code cannot reach a figure that
 * was frozen months ago. Every win recorded before it still carries the
 * estimate, and those are the numbers on the screen somebody is looking at
 * now.
 *
 * So this compares the two and says where they disagree. It CHANGES NO
 * TOTAL. Which figure is right for a deal concluded last year is a
 * question about that deal, and answering it belongs to whoever ran it —
 * this says where to look, and the screens offer to put it right one deal
 * at a time.
 *
 * THE DOCUMENT IT COMPARES AGAINST is the strongest single piece of
 * evidence there is, in the order a tax invoice, a sales order, a proforma,
 * a quotation — the same ladder as backing.ts, and for the same reason: a
 * quotation is us asking, an invoice is the customer having agreed.
 *
 * WHERE THERE IS MORE THAN ONE AT THAT TIER IT SAYS NOTHING, deliberately.
 * A client with four invoices across two years has not won one deal worth
 * the sum of them, and no rule this function could apply would know which
 * of them the win was about. Guessing would put wrong numbers on a screen
 * whose whole purpose is finding wrong numbers. `several` is reported
 * instead, so the deal can still be looked at by somebody who knows.
 */

export type EvidenceTier = "invoice" | "order" | "proforma" | "quotation" | "none";

/** The human word for each tier, for a sentence on a card. */
const TIER_LABEL: Record<EvidenceTier, string> = {
  invoice: "tax invoice",
  order: "sales order",
  proforma: "proforma",
  quotation: "quotation",
  none: "",
};

interface HasCustomer {
  id?: string;
  number?: string;
  customerId?: string;
  items?: unknown;
  taxType?: string | null;
}

export interface ReconcileSource {
  invoices?: readonly HasCustomer[];
  orders?: readonly HasCustomer[];
  proformas?: readonly HasCustomer[];
  quotations?: readonly HasCustomer[];
}

/** How a document's grand total is worked out. Passed in rather than
 *  imported so this module can be tested without the tax engine, and so
 *  the caller's seller state is the one that applies. */
export type TotalOf = (doc: HasCustomer) => number;

/**
 * The real one, for a caller that has a seller state.
 *
 * The tests pass their own `total` instead, so the comparison above can be
 * exercised without the tax engine in the way. This exists so the three
 * screens that need it do not each keep their own copy of "grand total of
 * a document" and drift apart on, say, whether round-off counts.
 */
export const grandTotalOf = (sellerState: string): TotalOf => (doc) =>
  computeDocument(doc as Parameters<typeof computeDocument>[0], sellerState).grand;

export interface WonFigure {
  /** What every revenue figure in the CRM is counting for this deal now. */
  recorded: number;
  /** What the document behind it says, or 0 where there is nothing to say. */
  documented: number;
  tier: EvidenceTier;
  /** The document the figure came from, for naming it on screen. */
  number: string;
  /** Several documents at the strongest tier: no comparison is offered. */
  several: boolean;
  /** The two figures agree, or there is nothing to compare them with. */
  matches: boolean;
}

/* Rupees. Two figures differing by less than one are the same figure
   rounded differently, not a mismatch worth a line on a screen. */
const SAME = 1;

const forCustomer = (docs: readonly HasCustomer[] | undefined, customerId: string): HasCustomer[] =>
  (docs ?? []).filter((d) => d.customerId === customerId);

export function wonFigure(
  customer: { id: string; value?: number | string; wonValue?: number },
  ws: ReconcileSource,
  total: TotalOf,
): WonFigure {
  const recorded = wonAmount(customer);

  /* Strongest evidence first, and only that tier: an order and the invoice
     raised from it are one sale, so totalling both would double it. */
  const tiers: [EvidenceTier, readonly HasCustomer[] | undefined][] = [
    ["invoice", ws.invoices],
    ["order", ws.orders],
    ["proforma", ws.proformas],
    ["quotation", ws.quotations],
  ];

  for (const [tier, docs] of tiers) {
    const mine = forCustomer(docs, customer.id);
    if (mine.length === 0) continue;
    if (mine.length > 1) {
      return { recorded, documented: 0, tier, number: "", several: true, matches: true };
    }
    const documented = total(mine[0]!);
    return {
      recorded,
      documented,
      tier,
      number: String(mine[0]!.number ?? ""),
      several: false,
      /* A document with no total priced on it says nothing about what the
         deal was worth, so it is not evidence of a mismatch. */
      matches: documented <= 0 || Math.abs(documented - recorded) < SAME,
    };
  }

  return { recorded, documented: 0, tier: "none", number: "", several: false, matches: true };
}

/** How to say it on screen, in words somebody can act on. Empty where the
 *  figures agree — a card only carries this when there is something wrong. */
export function mismatchNote(f: WonFigure, money: (n: number) => string): string {
  if (f.matches) return "";
  return `Counted as ${money(f.recorded)}, but ${f.number || TIER_LABEL[f.tier]} is ${money(f.documented)}`;
}

export interface WonMismatch<T> {
  customer: T;
  figure: WonFigure;
}

/**
 * Every won deal whose reported revenue disagrees with its paperwork.
 *
 * Reads `countsAsWon`, deliberately — the question is about what the
 * reports are counting, not which column a card is sitting in.
 */
export function wonMismatches<T extends { id: string; stage?: string; wonAt?: number; value?: number | string; wonValue?: number }>(
  customers: readonly T[],
  ws: ReconcileSource,
  total: TotalOf,
  since = 0,
): WonMismatch<T>[] {
  return customers
    .filter((c) => countsAsWon(c) && (c.wonAt ?? 0) >= since)
    .map((customer) => ({ customer, figure: wonFigure(customer, ws, total) }))
    .filter((row) => !row.figure.matches);
}
