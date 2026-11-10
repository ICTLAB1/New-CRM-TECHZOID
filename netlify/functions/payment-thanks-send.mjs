import { officeToday } from "../lib/today.mjs";
import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInProfile } from "../lib/auth.mjs";
import { renderThanksEmail } from "../lib/paymentMessages.mjs";
import { sendThanks } from "../lib/paymentSender.mjs";

/**
 * "Thank you for your payment", sent the moment one is recorded.
 *
 *   send     acknowledge one payment, once, ever
 *   preview  the email a payment would get, without sending it
 *
 * TWO PLACES RECORD A PAYMENT in this CRM and both come here: a bill in
 * the Payment Tracker, and a tax invoice on Receivables. They are
 * different tables that share nothing, so the caller says which — but
 * everything that decides WHO IS WRITTEN TO and WHAT THEY ARE THANKED
 * FOR is read back out of that table here. A browser that could name the
 * recipient and the amount could send any customer anything.
 *
 * THE ONE FIGURE THAT IS TAKEN ON TRUST is the invoice total for a CRM
 * invoice, used to print "balance remaining". A tax invoice's total is
 * computed from its lines by the GST rules in the app's own domain code,
 * which this server does not have and must not reimplement — two
 * implementations of a tax calculation disagree eventually, and the one
 * that disagrees in an email to a customer is the worse place to find
 * out. It is accepted as a display figure, validated as a finite
 * non-negative number, and when it is missing the email simply carries
 * the payment and no balance. The amount acknowledged is never taken
 * this way: that is read from the stored payment.
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const who = await signedInProfile(event);
  if (!who) return fail(event, 403, "Sign in required.");
  const userId = who.user.id;

  const body = readJson(event) ?? {};
  const source = body.source === "invoice" ? "invoice" : body.source === "bill" ? "bill" : null;
  if (!source) return fail(event, 400, "Which kind of record — a bill or an invoice?");
  const refId = String(body.refId ?? "");
  const paymentId = String(body.paymentId ?? "");
  if (!refId || !paymentId) return fail(event, 400, "Which payment?");

  const admin = adminClient();
  const today = officeToday();

  const found = source === "bill"
    ? await fromBill(admin, refId, paymentId)
    : await fromInvoice(admin, refId, paymentId, body);
  if (found.error) return fail(event, found.status, found.error, found.detail);
  const receipt = found.receipt;

  const { data: membership } = await admin
    .from("company_members").select("user_id")
    .eq("company_id", receipt.company_id).eq("user_id", userId).maybeSingle();
  if (!membership) return fail(event, 403, "That record belongs to another company.");

  const settings = await settingsOf(admin, receipt.company_id);
  /* Off by default would be the wrong default for a feature somebody
     asked for, but it has to be switchable: a company that sends its own
     receipts from Tally does not want two. */
  if (settings.thanksOn === false && body.action !== "preview") {
    return json(event, 200, { state: "off" });
  }

  if (body.action === "preview") {
    return json(event, 200, { to: receipt.email, ...renderThanksEmail(receipt, settings) });
  }
  if (body.action !== "send") return fail(event, 400, "Unknown action.");

  const result = await sendThanks({ admin, receipt, settings, today });
  return json(event, 200, result);
}

/* ── a Payment Tracker bill ─────────────────────────────────────────── */
async function fromBill(admin, billId, paymentId) {
  const { data: row, error } = await admin.from("payment_bills").select("*").eq("id", billId).maybeSingle();
  if (error) return { status: 500, error: "Could not read that bill.", detail: error.message };
  if (!row) return { status: 404, error: "That bill no longer exists." };

  const payments = Array.isArray(row.data?.payments) ? row.data.payments : [];
  const paid = payments.find((p) => String(p.id ?? "") === paymentId);
  if (!paid) return { status: 404, error: "That payment is not on the bill." };

  return {
    receipt: {
      source: "bill",
      ref_id: row.id,
      payment_id: paymentId,
      company_id: row.company_id,
      owner_id: row.owner_id,
      invoice_no: row.invoice_no,
      customer_name: row.customer_name,
      contact_name: row.contact_name,
      email: row.email,
      cc: row.cc,
      currency: row.currency,
      amount: num(row.amount),
      amount_paid: num(row.amount_paid),
      paid_now: num(paid.amount),
      paid_on: String(paid.date ?? "").slice(0, 10),
      method: paid.method ?? "",
      reference: paid.reference ?? "",
    },
  };
}

/* ── a CRM tax invoice ──────────────────────────────────────────────── */
async function fromInvoice(admin, invoiceId, paymentId, body) {
  const { data: row, error } = await admin.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (error) return { status: 500, error: "Could not read that invoice.", detail: error.message };
  if (!row) return { status: 404, error: "That invoice no longer exists." };

  const doc = row.data ?? {};
  const history = Array.isArray(doc.paymentHistory) ? doc.paymentHistory : [];
  const paid = history.find((p) => String(p.id ?? "") === paymentId);
  if (!paid) return { status: 404, error: "That payment is not on the invoice." };

  /* Everything received against this invoice, from the invoice itself —
     so "total received" cannot be inflated by the caller even though the
     invoice's own total can only come from there. */
  const received = history.reduce((sum, p) => sum + num(p.amount), 0);

  return {
    receipt: {
      source: "invoice",
      ref_id: row.id,
      payment_id: paymentId,
      company_id: row.company_id,
      owner_id: row.owner_id,
      invoice_no: doc.number ?? "",
      customer_name: doc.billName ?? "",
      contact_name: doc.billContact ?? "",
      email: doc.billEmail ?? "",
      cc: "",
      currency: doc.currency ?? "INR",
      amount: num(body.invoiceAmount),
      amount_paid: received,
      paid_now: num(paid.amount),
      paid_on: String(paid.date ?? "").slice(0, 10),
      method: paid.method ?? "",
      reference: paid.reference ?? "",
    },
  };
}

async function settingsOf(admin, companyId) {
  if (!companyId) {
    const { data } = await admin.from("payment_tracker_settings").select("data").limit(1);
    return data?.[0]?.data ?? {};
  }
  const { data } = await admin
    .from("payment_tracker_settings").select("data").eq("company_id", companyId).maybeSingle();
  return data?.data ?? {};
}
