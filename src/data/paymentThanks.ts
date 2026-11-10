import { fnPath, fnToken } from "./functions";
import { hasBackend } from "./backend";

/**
 * "Thank you for your payment", sent when one is recorded.
 *
 * TWO SCREENS RECORD A PAYMENT — a bill in the Payment Tracker, and a tax
 * invoice on Receivables — and both call this. Which record it was is all
 * the server is told; who gets written to, and what they are thanked for,
 * it reads back out of that record itself.
 *
 * NEVER BLOCKS THE SAVE. The payment is the thing being recorded; the
 * email is a consequence of it. A mail server that is slow, a mailbox
 * that has lost its consent, a customer with no email address on file —
 * none of those may stop a payment being entered, and none of them may
 * leave the person wondering whether the payment went in. So the caller
 * saves first and reports the outcome of this separately.
 *
 * Returns what happened rather than throwing it, because every outcome
 * here is ordinary: "already" is a double-click, "off" is a company that
 * issues its own receipts from Tally, and "failed" is worth a line on
 * screen but never an error dialog over a save that succeeded.
 */

export type ThanksOutcome =
  | { state: "sent" }
  | { state: "already" }
  | { state: "off" }
  | { state: "failed"; error: string };

export interface ThanksRequest {
  source: "bill" | "invoice";
  /** The bill's or the invoice's id. */
  refId: string;
  /** The id of the single payment entry being acknowledged. */
  paymentId: string;
  /**
   * The invoice's own total, for the "balance remaining" line, and only
   * for an invoice. A tax invoice's total is computed from its lines by
   * the GST rules in this app's domain code, which the server does not
   * have; the amount actually acknowledged always comes from the stored
   * payment, never from here.
   */
  invoiceAmount?: number;
}

export async function sendThanksFor(req: ThanksRequest): Promise<ThanksOutcome> {
  if (!hasBackend()) return { state: "off" };
  try {
    const token = await fnToken();
    const resp = await fetch(fnPath("payment-thanks-send"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: "send", ...req }),
    });
    const body = (await resp.json().catch(() => ({}))) as ThanksOutcome & { error?: string };
    if (!resp.ok) return { state: "failed", error: body?.error || `The server said ${resp.status}.` };
    if (body?.state === "sent" || body?.state === "already" || body?.state === "off") return { state: body.state };
    return { state: "failed", error: body?.error || "The acknowledgement was not sent." };
  } catch (e) {
    return { state: "failed", error: (e as Error)?.message || "The acknowledgement could not be sent." };
  }
}

/** What to put on screen after a payment was saved. Null when there is
 *  nothing worth saying — a company with this switched off does not want
 *  a line about it on every payment. */
export function thanksNote(outcome: ThanksOutcome, who: string): string | null {
  switch (outcome.state) {
    case "sent": return `Thank-you email sent to ${who || "the customer"}.`;
    case "already": return null;
    case "off": return null;
    case "failed": return `Payment saved. The thank-you email was not sent: ${outcome.error}`;
  }
}
