import { countsAsWon } from "./stages";

/**
 * Is a won deal backed by anything?
 *
 * WHY THIS EXISTS. Marking a deal Won is one click, and nothing in the CRM
 * checks that anything was actually sold. On a live workspace, nine of
 * fifteen deals counted as won had no document of any kind against them —
 * no quotation, no proforma, no invoice, no order — and only 8% of the
 * reported won revenue had an order behind it. The dashboard was not lying
 * about the arithmetic; it was reporting sales that existed only as a stage
 * somebody had set.
 *
 * WHAT COUNTS AS BACKING, and why it is not the quotation. A quotation is us
 * asking. An order or a tax invoice is the customer having agreed — that is
 * the difference between "quotation sent" and "order closed", and it is the
 * whole point of the check. A proforma sits in between: we have asked for
 * money, which is more than a quotation and less than a sale, so it is
 * counted separately and reported rather than treated as proof.
 *
 * THIS DOES NOT CHANGE ANY TOTAL. Won revenue is still what the stage says.
 * The flag says where to look; deciding that an unbacked win is not revenue
 * is a change to how the business reports itself, and belongs to whoever
 * runs it rather than to this function.
 */

export interface Backing {
  orders: number;
  invoices: number;
  proformas: number;
  quotations: number;
  /** An order or a tax invoice exists. The customer agreed to something. */
  backed: boolean;
  /** Nothing at all was ever raised — not even a quotation. The strongest
   *  signal that a stage was set by hand and nothing followed. */
  nothingRaised: boolean;
}

interface HasCustomer { customerId?: string }

export interface BackingSource {
  orders?: readonly HasCustomer[];
  invoices?: readonly HasCustomer[];
  proformas?: readonly HasCustomer[];
  quotations?: readonly HasCustomer[];
}

const countFor = (docs: readonly HasCustomer[] | undefined, customerId: string): number =>
  (docs ?? []).reduce((n, d) => (d.customerId === customerId ? n + 1 : n), 0);

export function backingFor(customerId: string, ws: BackingSource): Backing {
  const orders = countFor(ws.orders, customerId);
  const invoices = countFor(ws.invoices, customerId);
  const proformas = countFor(ws.proformas, customerId);
  const quotations = countFor(ws.quotations, customerId);
  return {
    orders, invoices, proformas, quotations,
    backed: orders > 0 || invoices > 0,
    nothingRaised: orders + invoices + proformas + quotations === 0,
  };
}

/** How to say it on screen, in words a salesperson can act on. */
export function backingNote(b: Backing): string {
  if (b.backed) return "";
  if (b.nothingRaised) return "Marked won, but nothing was ever raised against it";
  if (b.proformas > 0) {
    return `Marked won on a proforma — no order or invoice yet`;
  }
  return `Marked won on a quotation — no order or invoice yet`;
}

export interface UnbackedWin<T> {
  customer: T;
  backing: Backing;
}

/**
 * Every deal counting as won revenue with nothing behind it.
 *
 * Reads `countsAsWon`, deliberately — the question is about what the reports
 * are counting, not about which column a card is sitting in.
 */
export function unbackedWins<T extends { id: string; stage?: string; wonAt?: number }>(
  customers: readonly T[],
  ws: BackingSource,
  since = 0,
): UnbackedWin<T>[] {
  return customers
    .filter((c) => countsAsWon(c) && (c.wonAt ?? 0) >= since)
    .map((customer) => ({ customer, backing: backingFor(customer.id, ws) }))
    .filter((row) => !row.backing.backed);
}
