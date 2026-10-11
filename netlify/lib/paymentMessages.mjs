import { escapeHtml } from "./html.mjs";
import { daysBetween, outstandingOf } from "./paymentRules.mjs";

/**
 * The words of a payment reminder — email and WhatsApp.
 *
 * Polite before the due date, plain on it, firmer as the bill ages. Never
 * rude: these go to customers we want to keep. Every message carries the
 * amount, the invoice number and the due date, so a customer's accounts
 * person can act on it without opening anything else.
 */

export const DEFAULT_BANK = {
  bankName: "HDFC Bank",
  accountName: "TechZoid Technologies Private Limited",
  accountNumber: "50200058982457",
  ifsc: "HDFC0000331",
};

export const DEFAULT_TEMPLATES = {
  upcoming: "payment_due_reminder",
  due: "payment_due_reminder",
  overdue: "payment_overdue_reminder",
  firm: "payment_overdue_reminder",
  final: "payment_final_reminder",
};

export function money(amount, currency = "INR") {
  const code = String(currency || "INR").toUpperCase();
  try {
    return new Intl.NumberFormat(code === "INR" ? "en-IN" : "en-US", {
      style: "currency", currency: code, minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(Number(amount) || 0);
  } catch {
    return `${code} ${(Number(amount) || 0).toFixed(2)}`;
  }
}

export function fmtDate(iso) {
  const t = Date.parse(String(iso).slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(t)) return String(iso ?? "");
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(t);
}

/** Who the message greets: the person, then the company, then "Sir/Madam". */
export function greetingName(row) {
  return String(row.contact_name ?? "").trim() || String(row.customer_name ?? "").trim() || "Sir/Madam";
}

function lines(tone, days, f) {
  switch (tone) {
    case "upcoming":
      return {
        subject: `Payment reminder: Invoice ${f.invoice} due on ${f.due}`,
        opening: `This is a friendly reminder that payment for invoice ${f.invoice} dated ${f.invoiceDate} falls due on ${f.due}.`,
        ask: `We would be grateful if you could schedule the payment of ${f.outstanding} on or before the due date.`,
      };
    case "due":
      return {
        subject: `Payment due today: Invoice ${f.invoice}`,
        opening: `Payment for invoice ${f.invoice} dated ${f.invoiceDate} is due today (${f.due}).`,
        ask: `Kindly arrange the payment of ${f.outstanding} at the earliest. If it has already been processed, please share the UTR/reference so we can update our records.`,
      };
    case "overdue":
      return {
        subject: `Payment overdue: Invoice ${f.invoice} (${days} days)`,
        opening: `Our records show that payment for invoice ${f.invoice}, due on ${f.due}, is now ${days} days overdue.`,
        ask: `We request you to release the outstanding amount of ${f.outstanding} at the earliest. If the payment has already been made, please share the transaction reference and ignore this reminder.`,
      };
    case "firm":
      return {
        subject: `Second reminder: ${f.outstanding} overdue on Invoice ${f.invoice}`,
        opening: `Despite our earlier reminders, payment for invoice ${f.invoice} (due ${f.due}) remains outstanding and is now ${days} days overdue.`,
        ask: `We request you to clear the outstanding amount of ${f.outstanding} within the next few days, or let us know a firm payment date. If there is any issue with the invoice, please tell us so we can resolve it quickly.`,
      };
    default:
      return {
        subject: `Urgent: Invoice ${f.invoice} is ${days} days overdue`,
        opening: `Payment for invoice ${f.invoice} (due ${f.due}) is now ${days} days overdue, and the amount of ${f.outstanding} is still outstanding.`,
        ask: `We request your immediate attention to clear this amount. Please confirm a payment date by reply, or call us so we can resolve any open issue. Continued delay may affect credit terms on future orders.`,
      };
  }
}

/**
 * @param {object} row       a payment_bills row
 * @param {string} tone      upcoming | due | overdue | firm | final
 * @param {string} today     yyyy-mm-dd
 * @param {object} settings  the company's tracker settings
 */
export function renderReminderEmail(row, tone, today, settings = {}) {
  const currency = row.currency || "INR";
  const outstanding = outstandingOf({ amount: row.amount, amountPaid: row.amount_paid });
  const paidSome = (Number(row.amount_paid) || 0) > 0;
  const days = Math.max(0, daysBetween(String(row.due_date).slice(0, 10), today));
  const company = String(settings.companyName || "TechZoid Technologies Pvt. Ltd.");
  const bank = { ...DEFAULT_BANK, ...(settings.bank ?? {}) };
  const f = {
    invoice: String(row.invoice_no),
    invoiceDate: fmtDate(row.invoice_date),
    due: fmtDate(row.due_date),
    outstanding: money(outstanding, currency),
  };
  const words = lines(tone, days, f);
  const name = greetingName(row);
  const contactLine = String(settings.contactLine || "").trim();
  const signOff = String(settings.signOff || `Accounts Team\n${company}`).trim();

  const facts = [
    ["Invoice no.", f.invoice],
    ["Invoice date", f.invoiceDate],
    ["Due date", f.due],
    ["Invoice amount", money(row.amount, currency)],
    ...(paidSome ? [["Received so far", money(row.amount_paid, currency)]] : []),
    ["Amount outstanding", f.outstanding],
  ];
  const bankRows = [
    ["Bank", bank.bankName],
    ["Account name", bank.accountName],
    ["Account no.", bank.accountNumber],
    ["IFSC", bank.ifsc],
    ...(bank.upi ? [["UPI", bank.upi]] : []),
  ].filter(([, v]) => String(v ?? "").trim());

  const text = [
    `Dear ${name},`,
    "",
    words.opening,
    "",
    ...facts.map(([k, v]) => `${k}: ${v}`),
    "",
    words.ask,
    "",
    ...(bankRows.length ? ["Bank details for payment:", ...bankRows.map(([k, v]) => `${k}: ${v}`), ""] : []),
    ...(contactLine ? [contactLine, ""] : []),
    "Thank you for your business.",
    "",
    "Regards,",
    signOff,
  ].join("\n");

  const accent = tone === "final" ? "#b42318" : tone === "firm" ? "#b54708" : "#1f4fd1";
  const tr = ([k, v], strong) =>
    `<tr><td style="padding:6px 0;color:#667085;font-size:13px">${escapeHtml(k)}</td>` +
    `<td style="padding:6px 0;text-align:right;font-size:13px;${strong ? "font-weight:700;color:#101828" : "color:#344054"}">${escapeHtml(v)}</td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#344054">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e4e7ec">
<tr><td style="height:4px;background:${accent}"></td></tr>
<tr><td style="padding:26px 28px 8px">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${accent};font-weight:700">${escapeHtml(tone === "upcoming" ? "Payment reminder" : tone === "due" ? "Payment due today" : "Payment overdue")}</div>
<p style="margin:16px 0 0;font-size:14px;line-height:1.6">Dear ${escapeHtml(name)},</p>
<p style="margin:12px 0 0;font-size:14px;line-height:1.6">${escapeHtml(words.opening)}</p>
</td></tr>
<tr><td style="padding:12px 28px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eaecf0;border-bottom:1px solid #eaecf0">
${facts.map((r, i) => tr(r, i === facts.length - 1)).join("\n")}
</table>
</td></tr>
<tr><td style="padding:4px 28px 8px"><p style="margin:0;font-size:14px;line-height:1.6">${escapeHtml(words.ask)}</p></td></tr>
${bankRows.length ? `<tr><td style="padding:12px 28px"><div style="background:#f9fafb;border:1px solid #eaecf0;border-radius:8px;padding:12px 14px">
<div style="font-size:12px;font-weight:700;color:#475467;margin-bottom:4px">Bank details for payment</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${bankRows.map((r) => tr(r, false)).join("")}</table></div></td></tr>` : ""}
<tr><td style="padding:8px 28px 26px;font-size:14px;line-height:1.6">
${contactLine ? `<p style="margin:0 0 12px">${escapeHtml(contactLine)}</p>` : ""}
<p style="margin:0">Thank you for your business.</p>
<p style="margin:12px 0 0">Regards,<br>${escapeHtml(signOff).replace(/\n/g, "<br>")}</p>
</td></tr>
</table>
<div style="font-size:11px;color:#98a2b3;padding:12px">If you have already made this payment, please ignore this message or reply with the payment reference.</div>
</td></tr></table></body></html>`;

  return { subject: words.subject, text, html };
}

/**
 * WhatsApp: an approved template and its four placeholders.
 *   {{1}} name   {{2}} invoice no.   {{3}} amount outstanding   {{4}} due date
 */
export function whatsappFor(row, tone, settings = {}) {
  const names = { ...DEFAULT_TEMPLATES, ...(settings.waTemplates ?? {}) };
  const outstanding = outstandingOf({ amount: row.amount, amountPaid: row.amount_paid });
  return {
    templateName: String(names[tone] || DEFAULT_TEMPLATES[tone] || "").trim(),
    bodyValues: [
      greetingName(row),
      String(row.invoice_no),
      money(outstanding, row.currency || "INR"),
      fmtDate(row.due_date),
    ],
  };
}

/** The morning summary for the team. */
export function renderDigest(rows, today, settings = {}) {
  const items = rows.map((r) => ({
    row: r,
    days: daysBetween(String(r.due_date).slice(0, 10), today),
    outstanding: outstandingOf({ amount: r.amount, amountPaid: r.amount_paid }),
  })).filter((x) => x.outstanding > 0);

  const overdue = items.filter((x) => x.days > 0).sort((a, b) => b.days - a.days);
  const dueToday = items.filter((x) => x.days === 0);
  const dueWeek = items.filter((x) => x.days < 0 && x.days >= -7).sort((a, b) => b.days - a.days);

  const sum = (list) => {
    const by = {};
    for (const x of list) by[x.row.currency || "INR"] = (by[x.row.currency || "INR"] ?? 0) + x.outstanding;
    return Object.entries(by).map(([c, v]) => money(v, c)).join(" + ") || money(0);
  };

  const section = (title, list, colour) => list.length === 0 ? "" : `
<h3 style="margin:22px 0 8px;font-size:14px;color:${colour}">${escapeHtml(title)} — ${list.length} bill(s), ${escapeHtml(sum(list))}</h3>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">
${list.map((x) => `<tr style="border-bottom:1px solid #eaecf0">
<td style="padding:6px 0">${escapeHtml(x.row.customer_name)}<div style="color:#98a2b3;font-size:12px">${escapeHtml(x.row.invoice_no)} · due ${escapeHtml(fmtDate(x.row.due_date))}</div></td>
<td style="padding:6px 0;text-align:right;white-space:nowrap">${escapeHtml(money(x.outstanding, x.row.currency || "INR"))}<div style="color:#98a2b3;font-size:12px">${x.days > 0 ? `${x.days}d overdue` : x.days === 0 ? "due today" : `in ${-x.days}d`}</div></td></tr>`).join("")}
</table>`;

  const total = overdue.length + dueToday.length + dueWeek.length;
  const subject = `Payments: ${overdue.length} overdue (${sum(overdue)}), ${dueToday.length} due today — ${fmtDate(today)}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#344054">
<div style="max-width:620px;margin:0 auto;padding:24px 12px"><div style="background:#fff;border:1px solid #e4e7ec;border-radius:10px;padding:24px 26px">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#1f4fd1;font-weight:700">Payment Tracker · ${escapeHtml(fmtDate(today))}</div>
<h2 style="margin:8px 0 0;font-size:20px;color:#101828">${escapeHtml(sum(items))} outstanding across ${items.length} bill(s)</h2>
${total === 0 ? `<p style="font-size:14px">Nothing overdue or due this week.</p>` : ""}
${section("Overdue", overdue, "#b42318")}
${section("Due today", dueToday, "#b54708")}
${section("Due in the next 7 days", dueWeek, "#1f4fd1")}
${settings.appUrl ? `<p style="margin:22px 0 0;font-size:13px"><a href="${escapeHtml(settings.appUrl)}" style="color:#1f4fd1">Open the Payment Tracker</a></p>` : ""}
</div></div></body></html>`;
  const text = [
    subject, "",
    ...overdue.map((x) => `OVERDUE ${x.days}d — ${x.row.customer_name} — ${x.row.invoice_no} — ${money(x.outstanding, x.row.currency || "INR")}`),
    ...dueToday.map((x) => `DUE TODAY — ${x.row.customer_name} — ${x.row.invoice_no} — ${money(x.outstanding, x.row.currency || "INR")}`),
    ...dueWeek.map((x) => `Due in ${-x.days}d — ${x.row.customer_name} — ${x.row.invoice_no} — ${money(x.outstanding, x.row.currency || "INR")}`),
  ].join("\n");
  return { subject, html, text, count: total };
}
