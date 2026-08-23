import { round2 } from "../money";

export const PAYMENT_METHODS = [
  "Bank Transfer / NEFT / RTGS",
  "UPI",
  "Cheque",
  "Cash",
  "Credit Card",
  "Other",
] as const;

export interface PaymentEntry {
  id?: string;
  amount?: number | string;
  date?: string;
  method?: string;
  reference?: string;
}

export type PaymentStatus = "unpaid" | "partial" | "paid";

export interface PaymentInfo {
  amountPaid: number;
  outstanding: number;
  /** 0–100, capped. */
  pct: number;
  paymentStatus: PaymentStatus;
  overdue: boolean;
}

/** Legacy proformas predate paymentHistory entirely — treat a missing
 *  ledger as an empty one rather than assuming the field exists. */
export interface PayableDocument {
  paymentHistory?: PaymentEntry[] | null;
  validUntil?: string | null;
}

const todayISO = (): string => new Date().toISOString().slice(0, 10);

/**
 * Payment status is DERIVED from the ledger — never stored, never inferred
 * from a status field that someone may have set by hand.
 *
 * Edge cases that are load-bearing:
 *   - zero-value proforma: no divide-by-zero, pct stays 0
 *   - overpayment: pct capped at 100, outstanding floored at 0
 *   - floating-point drift: every sum passes through round2
 *
 * Recording a payment never changes document status on its own. This
 * function reports; the admin decides.
 */
export function computePaymentInfo(doc: PayableDocument, grand: number, today: string = todayISO()): PaymentInfo {
  const history = doc.paymentHistory || [];
  const amountPaid = round2(history.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const outstanding = round2(Math.max(0, grand - amountPaid));
  const pct = grand > 0 ? Math.min(100, Math.round((amountPaid / grand) * 100)) : 0;
  const paymentStatus: PaymentStatus = amountPaid <= 0 ? "unpaid" : amountPaid >= grand ? "paid" : "partial";
  const overdue = paymentStatus !== "paid" && !!doc.validUntil && doc.validUntil < today;
  return { amountPaid, outstanding, pct, paymentStatus, overdue };
}
