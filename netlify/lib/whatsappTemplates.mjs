/**
 * The eight approved WhatsApp templates, and what goes in their blanks.
 *
 * THE WORDING IS NOT HERE, AND MUST NOT BE. Each template's sentences were
 * approved by Meta and live in the WhatsApp Business account; this file only
 * decides what is substituted into {{1}}, {{2}} and so on, in order. Writing
 * the words here too would create a second copy that drifts from the
 * approved one, and the preview on screen would then show a customer
 * something they will never receive. The real wording is read from Meta
 * through the WABA id — see readApprovedTemplates below.
 *
 * WHAT META REFUSES, which is most of the care taken in this file:
 *
 *   · an EMPTY parameter. "param text cannot be empty" fails the whole
 *     message, so every value here has a fallback and none can come out "".
 *   · a parameter containing a NEWLINE or a TAB, or four spaces in a row.
 *     A list of order items is the obvious way to trip this, so lists are
 *     flattened onto one line here rather than at the call site.
 *   · more or fewer parameters than the approved template expects.
 *
 * Each of these is a message that silently does not reach a customer, so
 * each is handled rather than hoped about.
 */

/* ── formatting, as the customer reads it ───────────────────────────── */

/** "15 Nov 2026". The format the business asked for, in every template. */
export function waDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * "1,18,000" — Indian grouping, no symbol, no paise.
 *
 * No ₹ because the approved wording carries the currency word itself, and
 * no paise because an invoice for 1,18,000.00 reads as a machine wrote it.
 * A figure with real paise keeps them.
 */
export function waMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  const whole = Math.abs(n % 1) < 0.005;
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

/**
 * One line, no runs of spaces, trimmed to length.
 *
 * Meta rejects a parameter with a newline or a tab in it, and the natural
 * way to fill "items" is to join a list with newlines. Rather than trust
 * every call site to remember, everything passes through here.
 */
export function waText(value, max = 300) {
  let flat = String(value ?? "");

  /* THE COMMAS GO IN ONLY WHERE A LINE BREAK CAME OUT. An earlier version
     tidied commas everywhere, and turned the amount 1,18,000 into
     "1, 18, 000" on its way to a customer's invoice reminder. The joining
     is a list problem; a number is not a list. */
  if (/[\r\n\t]/.test(flat)) {
    flat = flat
      .split(/[\r\n\t]+/)
      .map((part) => part.trim().replace(/^,+|,+$/g, "").trim())
      .filter(Boolean)
      .join(", ");
  }

  flat = flat.replace(/\s{2,}/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** A list of things, as one readable line: "M365 E3 ×10, Visio Plan 2 ×2". */
export function waList(items, max = 300) {
  const parts = (Array.isArray(items) ? items : [])
    .map((it) => {
      if (typeof it === "string") return waText(it, 80);
      const desc = waText(it?.desc ?? it?.name ?? it?.product ?? "", 80);
      const qty = Number(it?.qty ?? 0);
      return desc && qty > 1 ? `${desc} ×${qty}` : desc;
    })
    .filter(Boolean);
  if (!parts.length) return "";
  /* Three named, then a count. A customer does not read a line of nine
     SKUs, and Meta will not take one that long anyway. */
  const shown = parts.slice(0, 3).join(", ");
  const rest = parts.length - 3;
  return waText(rest > 0 ? `${shown} and ${rest} more item${rest === 1 ? "" : "s"}` : shown, max);
}

/* ── the eight ──────────────────────────────────────────────────────── */

/**
 * `params` is the ORDER Meta expects, and the order is the whole contract:
 * swapping two of them sends a customer somebody else's invoice number with
 * no error anywhere. `fallback` is what goes in when the record has nothing,
 * because an empty parameter fails the send outright.
 *
 * `auto` is the settings key for this message's on/off switch. Every one of
 * them is off until somebody turns it on.
 */
export const TEMPLATES = {
  quotation_sent: {
    name: "quotation_sent",
    label: "Quotation sent",
    when: "A quotation is emailed to the customer",
    auto: "quotationSent",
    manual: true,
    params: [
      { key: "customer", label: "Customer name", fallback: "there" },
      { key: "quoteNo", label: "Quotation number", fallback: "(number to follow)" },
      { key: "product", label: "Product", fallback: "the items quoted" },
      { key: "validTill", label: "Valid till", kind: "date", fallback: "the date on the quotation" },
    ],
  },
  quotation_followup: {
    name: "quotation_followup",
    label: "Quotation follow-up",
    when: "A quotation has had no answer for three days",
    auto: "quotationFollowup",
    manual: true,
    params: [
      { key: "customer", label: "Customer name", fallback: "there" },
      { key: "quoteNo", label: "Quotation number", fallback: "(number to follow)" },
      { key: "product", label: "Product", fallback: "the items quoted" },
      { key: "sharedOn", label: "Date shared", kind: "date", fallback: "recently" },
    ],
  },
  order_delivered: {
    name: "order_delivered",
    label: "Order delivered",
    when: "An order is marked delivered",
    auto: "orderDelivered",
    manual: true,
    params: [
      { key: "customer", label: "Customer name", fallback: "there" },
      { key: "orderNo", label: "Order number", fallback: "(number to follow)" },
      { key: "items", label: "Items", fallback: "the items ordered" },
      { key: "deliveredOn", label: "Delivery date", kind: "date", fallback: "today" },
    ],
  },
  licence_delivered: {
    name: "licence_delivered",
    label: "Licence keys sent",
    when: "Licence keys are marked as sent",
    auto: "licenceDelivered",
    manual: true,
    params: [
      { key: "customer", label: "Customer name", fallback: "there" },
      { key: "product", label: "Product", fallback: "the software ordered" },
      { key: "orderNo", label: "Order number", fallback: "(number to follow)" },
      { key: "sentTo", label: "Email they went to", fallback: "your registered email" },
    ],
  },
  payment_due_reminder: {
    name: "payment_due_reminder",
    label: "Payment due in 3 days",
    when: "Three days before an invoice falls due",
    auto: "paymentDue",
    manual: true,
    params: [
      { key: "customer", label: "Customer name", fallback: "there" },
      { key: "invoiceNo", label: "Invoice number", fallback: "(number to follow)" },
      { key: "amount", label: "Amount", kind: "money", fallback: "the invoiced amount" },
      { key: "dueOn", label: "Due date", kind: "date", fallback: "the due date" },
    ],
  },
  payment_overdue_reminder: {
    name: "payment_overdue_reminder",
    label: "Payment overdue",
    when: "The day after the due date, then every seven days until paid",
    auto: "paymentOverdue",
    manual: true,
    params: [
      { key: "customer", label: "Customer name", fallback: "there" },
      { key: "invoiceNo", label: "Invoice number", fallback: "(number to follow)" },
      { key: "amount", label: "Amount", kind: "money", fallback: "the invoiced amount" },
      { key: "dueOn", label: "Due date", kind: "date", fallback: "the due date" },
      { key: "daysOverdue", label: "Days overdue", fallback: "a few" },
    ],
  },
  payment_received: {
    name: "payment_received",
    label: "Payment received",
    when: "A payment is recorded",
    auto: "paymentReceived",
    manual: true,
    params: [
      { key: "customer", label: "Customer name", fallback: "there" },
      { key: "amount", label: "Amount", kind: "money", fallback: "your payment" },
      { key: "against", label: "Against", fallback: "your account" },
    ],
  },
  renewal_reminder: {
    name: "renewal_reminder",
    label: "Renewal in 30 days",
    when: "Thirty days before a subscription renews",
    auto: "renewalReminder",
    manual: true,
    params: [
      { key: "customer", label: "Customer name", fallback: "there" },
      { key: "product", label: "Product", fallback: "your subscription" },
      { key: "renewsOn", label: "Renewal date", kind: "date", fallback: "shortly" },
    ],
  },
};

/** Every template name, in the order the settings screen lists them. */
export const TEMPLATE_NAMES = Object.keys(TEMPLATES);

/** The settings key for a template's automatic switch. */
export const autoKeyOf = (name) => TEMPLATES[name]?.auto ?? "";

/**
 * Turn named facts into the ordered list of strings Meta wants.
 *
 * Returns `{ values, missing }`: `missing` names the facts that fell back,
 * so a preview can say "we do not have a quotation number for this" rather
 * than quietly sending the word "your quotation" to a customer.
 */
export function buildParams(templateName, facts = {}) {
  const template = TEMPLATES[templateName];
  if (!template) return { values: [], missing: [], error: `There is no template called ${templateName}.` };

  const values = [];
  const missing = [];

  for (const param of template.params) {
    const raw = facts[param.key];
    let text = "";

    if (raw !== undefined && raw !== null && String(raw).trim() !== "") {
      if (param.kind === "date") text = waText(waDate(raw), 40);
      else if (param.kind === "money") text = waText(waMoney(raw), 40);
      else if (Array.isArray(raw)) text = waList(raw);
      else text = waText(raw);
    }

    if (!text) {
      missing.push(param.key);
      text = param.fallback;
    }
    values.push(text);
  }

  return { values, missing };
}

/**
 * Fill the approved wording for a preview.
 *
 * `body` is the text as Meta holds it, with {{1}} … {{n}} in it. This only
 * substitutes; it never invents a sentence. When the approved wording could
 * not be read, the caller shows the parameters on their own and says so.
 */
export function fillBody(body, values) {
  return String(body ?? "").replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, n) => {
    const value = values[Number(n) - 1];
    return value === undefined ? whole : String(value);
  });
}

/**
 * The approved templates, read from the WhatsApp Business account.
 *
 * WHY ASK META RATHER THAN KEEP A COPY. The words belong to the approved
 * template; a copy here would be a second source of truth and the first
 * edit in Meta's console would make the preview a lie. This also surfaces
 * the two failures that otherwise show up as a silently unsent message: a
 * template that is not approved yet, and one whose parameter count does not
 * match what this file sends.
 *
 * Returns { ok: true, templates: {...} } or { ok: false, error } — never
 * throws, because a preview that cannot reach Meta should still show the
 * parameters.
 */
/**
 * The same, remembered for a few minutes.
 *
 * WHY: the daily reminder run can send two hundred messages, and each one
 * wants the approved wording so the log holds what the customer actually
 * read. Asking Meta two hundred times for the same answer is two hundred
 * round trips and a rate limit waiting to happen. The wording changes when
 * somebody edits a template in Meta and waits for it to be approved again,
 * which is not a thing that happens between two messages in one run.
 *
 * ONLY SUCCESSES ARE KEPT. A failure must be tried again — otherwise one
 * blip would leave every message in the run with no words recorded.
 */
let cached = { at: 0, key: "", result: null };

export async function approvedTemplates({ token, wabaId, fetchImpl = fetch, maxAgeMs = 600_000 } = {}) {
  const key = String(wabaId ?? "");
  const now = Date.now();
  if (cached.result && cached.key === key && now - cached.at < maxAgeMs) return cached.result;

  const result = await readApprovedTemplates({ token, wabaId, fetchImpl });
  if (result.ok) cached = { at: now, key, result };
  return result;
}

/** For tests, and for anything that has just changed a template in Meta. */
export function forgetApprovedTemplates() {
  cached = { at: 0, key: "", result: null };
}

export async function readApprovedTemplates({ token, wabaId, fetchImpl = fetch } = {}) {
  if (!token || !wabaId) {
    return { ok: false, error: "The WhatsApp Business account id or token is not set on the server." };
  }
  try {
    const url = `https://graph.facebook.com/v25.0/${encodeURIComponent(wabaId)}/message_templates`
      + "?fields=name,status,language,components&limit=100";
    const resp = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, error: metaError(result) || "Meta would not list the templates." };
    }

    const templates = {};
    for (const row of result?.data ?? []) {
      const body = (row?.components ?? []).find((c) => String(c?.type).toUpperCase() === "BODY");
      const text = String(body?.text ?? "");
      templates[row.name] = {
        name: row.name,
        status: String(row.status ?? "").toUpperCase(),
        language: row.language ?? "",
        body: text,
        /* The highest {{n}} the approved wording actually uses. */
        placeholders: Math.max(0, ...[...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))),
      };
    }
    return { ok: true, templates };
  } catch (err) {
    return { ok: false, error: `Could not reach Meta. ${err?.message ?? ""}`.trim() };
  }
}

/**
 * What is wrong with a template, if anything, before anybody relies on it.
 *
 * Checked against what Meta says rather than against hope: a template that
 * is still in review, or that was edited to take five parameters while this
 * file sends four, fails at send time with an error nobody is watching for.
 */
export function checkTemplate(templateName, approved) {
  const mine = TEMPLATES[templateName];
  if (!mine) return { ok: false, problem: `There is no template called ${templateName}.` };
  if (!approved) return { ok: false, problem: "Not found in the WhatsApp Business account." };
  if (approved.status !== "APPROVED") {
    return { ok: false, problem: `Meta has it as ${approved.status.toLowerCase() || "not approved"}.` };
  }
  if (approved.placeholders !== mine.params.length) {
    return {
      ok: false,
      problem: `The approved wording uses ${approved.placeholders} blank${approved.placeholders === 1 ? "" : "s"}`
        + ` and the CRM fills ${mine.params.length}.`,
    };
  }
  return { ok: true, problem: "" };
}

/** Meta's error wording, dug out of whichever shape it arrived in. */
export function metaError(result) {
  const e = result?.error ?? {};
  return String(e.error_user_title ? `${e.error_user_title}: ${e.error_user_msg ?? ""}` : e.message ?? "").trim();
}
