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
      { key: "customer", label: "Customer name" },
      { key: "quoteNo", label: "Quotation number" },
      { key: "product", label: "Product" },
      { key: "validTill", label: "Valid till", kind: "date" },
    ],
  },
  quotation_followup: {
    name: "quotation_followup",
    label: "Quotation follow-up",
    when: "A quotation has had no answer for three days",
    auto: "quotationFollowup",
    manual: true,
    params: [
      { key: "customer", label: "Customer name" },
      { key: "quoteNo", label: "Quotation number" },
      { key: "product", label: "Product" },
      { key: "sharedOn", label: "Date shared", kind: "date" },
    ],
  },
  order_delivered: {
    name: "order_delivered",
    label: "Order delivered",
    when: "An order is marked delivered",
    auto: "orderDelivered",
    manual: true,
    params: [
      { key: "customer", label: "Customer name" },
      { key: "orderNo", label: "Order number" },
      { key: "items", label: "Items" },
      { key: "deliveredOn", label: "Delivery date", kind: "date" },
    ],
  },
  licence_delivered: {
    name: "licence_delivered",
    label: "Licence keys sent",
    when: "Licence keys are marked as sent",
    auto: "licenceDelivered",
    manual: true,
    params: [
      { key: "customer", label: "Customer name" },
      { key: "product", label: "Product" },
      { key: "orderNo", label: "Order number" },
      { key: "sentTo", label: "Email they went to" },
    ],
  },
  payment_due_reminder: {
    name: "payment_due_reminder",
    label: "Payment due in 3 days",
    when: "Three days before an invoice falls due",
    auto: "paymentDue",
    manual: true,
    params: [
      { key: "customer", label: "Customer name" },
      { key: "invoiceNo", label: "Invoice number" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "dueOn", label: "Due date", kind: "date" },
    ],
  },
  payment_overdue_reminder: {
    name: "payment_overdue_reminder",
    label: "Payment overdue",
    when: "The day after the due date, then every seven days until paid",
    auto: "paymentOverdue",
    manual: true,
    params: [
      { key: "customer", label: "Customer name" },
      { key: "invoiceNo", label: "Invoice number" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "dueOn", label: "Due date", kind: "date" },
      { key: "daysOverdue", label: "Days overdue" },
    ],
  },
  payment_received: {
    name: "payment_received",
    label: "Payment received",
    when: "A payment is recorded",
    auto: "paymentReceived",
    manual: true,
    params: [
      { key: "customer", label: "Customer name" },
      { key: "amount", label: "Amount", kind: "money" },
      { key: "against", label: "Against" },
    ],
  },
  renewal_reminder: {
    name: "renewal_reminder",
    label: "Renewal in 30 days",
    when: "Thirty days before a subscription renews",
    auto: "renewalReminder",
    manual: true,
    params: [
      { key: "customer", label: "Customer name" },
      { key: "product", label: "Product" },
      { key: "renewsOn", label: "Renewal date", kind: "date" },
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

    if (!text) missing.push(param.key);
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

/**
 * WHAT EACH ONE IS CALLED IN META, and what it used to be called.
 *
 * The names inside this CRM do not change: they are the keys of the switches
 * a company has already set, the `template` written against every message
 * ever sent, and what the screens look messages up by. Renaming them would
 * rewrite history and silently turn switches off.
 *
 * What changed is the name AT META. The templates were resubmitted as
 * `_v2`, so that is what goes on the wire — with the old name kept beside it
 * because the new ones are in review and a message must still go out in the
 * meantime. `sendMessage` tries the new name and falls back to the old one
 * when Meta says it does not have it.
 */
for (const [key, spec] of Object.entries(TEMPLATES)) {
  spec.metaName = `${key}_v2`;
  spec.legacyName = key;
}

/* THE QUOTATION MESSAGE CARRIES THE QUOTATION. `quotation_sent_v2` is
   created in Meta with a document header, so every send of it must have the
   PDF; without one there is nothing to do but send the old text-only
   template instead. The follow-up stays text-only in both versions — it goes
   out from the 10am job, where there is no browser and so no way to render a
   quotation. */
TEMPLATES.quotation_sent.document = true;

/** Does the name Meta knows this by take a document header? */
export const needsDocument = (templateName) => !!TEMPLATES[templateName]?.document;

/**
 * Which name to try at Meta, and what to try if that one is not there.
 *
 * THE NEW NAMES ARE IN REVIEW. `quotation_sent_v2` and the rest were
 * resubmitted and Meta takes its time; until each is approved, sending it
 * comes back as "template name does not exist". So every send names the new
 * one, and `sendMessage` falls back once to the old one when Meta says it
 * does not have it. Nothing has to be edited on the day a review finishes —
 * the next message simply goes out on the new template.
 *
 * THE QUOTATION MESSAGE IS THE ONE EXCEPTION, because its new version
 * carries the PDF in a header and its old version does not. With a PDF in
 * hand, the new name is tried and the old one is the fallback, sent without
 * the attachment. With no PDF there is no point trying: a template with a
 * header cannot be sent without a file, so the old name is used directly.
 */
export function nameFor(templateName, { hasPdf = false } = {}) {
  const spec = TEMPLATES[templateName];
  if (!spec) return { meta: "", legacy: "", wantsPdf: false, why: `There is no template called ${templateName}.` };

  if (spec.document && !hasPdf) {
    return {
      meta: spec.legacyName,
      legacy: "",
      wantsPdf: false,
      why: "the quotation PDF could not be built, so the message goes without it",
    };
  }
  return { meta: spec.metaName, legacy: spec.legacyName, wantsPdf: !!spec.document, why: "" };
}

/** What the attached file is called, as the customer sees it. */
export function documentName(quoteNo) {
  const clean = String(quoteNo ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `Quotation_${clean || "TechZoid"}.pdf`;
}

/** Meta's error wording, dug out of whichever shape it arrived in. */
export function metaError(result) {
  const e = result?.error ?? {};
  return String(e.error_user_title ? `${e.error_user_title}: ${e.error_user_msg ?? ""}` : e.message ?? "").trim();
}
