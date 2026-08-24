/**
 * Turning an event from the website into a CRM customer record.
 *
 * Kept separate from the handler so the mapping is unit-testable without a
 * database — the same split as `webhookSign.mjs`.
 *
 * FIELD NAMES ARE READ GENEROUSLY. The website's published spec documents
 * its headers, its retry policy and its five event kinds, but not the field
 * names inside `data`. Rather than guess one spelling and silently drop
 * everything else, each field is looked for under the handful of names it
 * plausibly arrives as, and THE WHOLE ORIGINAL PAYLOAD IS KEPT on the record
 * under `websitePayload`. Nothing that arrives is ever lost, even if this
 * mapping does not recognise it — so a field named unexpectedly shows up as
 * data to correct, not as data destroyed.
 */

/** First non-empty value among several possible field names. */
function pick(source, ...names) {
  for (const name of names) {
    const value = source?.[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

/** The CRM's pipeline stages. Anything unrecognised is left alone rather
 *  than forced into one, so an unexpected stage name is visible instead of
 *  silently becoming "lead". */
const STAGES = ["lead", "contacted", "qualified", "quoted", "negotiation", "won", "lost"];

export function normaliseStage(value) {
  const clean = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (STAGES.includes(clean)) return clean;
  /* A few spellings worth accepting, because they mean exactly one of ours. */
  if (clean === "new" || clean === "enquiry" || clean === "inquiry") return "lead";
  if (clean === "closed_won") return "won";
  if (clean === "closed_lost") return "lost";
  return null;
}

/**
 * The website's id for a deal, whatever it calls it.
 *
 * This is the join key between the two systems, so it has to be found or
 * the event cannot be applied at all.
 */
export function websiteDealId(data) {
  const id = pick(data, "dealId", "deal_id", "id", "leadId", "lead_id", "enquiryId", "enquiry_id");
  return id === undefined ? null : String(id).trim();
}

/**
 * The CRM row id for a website deal.
 *
 * Derived from the website's own id rather than random, so a retry, an
 * update and a stage change all land on the SAME row instead of creating a
 * second copy of the same customer. The prefix keeps website-originated
 * records from ever colliding with ids generated inside the CRM.
 */
export function crmIdForWebsiteDeal(id) {
  return "web-" + String(id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
}

/**
 * Build the customer fields an event carries.
 *
 * Returns only what the event actually supplied — never a full record with
 * blanks — so merging this over an existing customer cannot wipe fields the
 * website does not know about. That matters: a stage-change event carrying
 * no phone number must not erase the phone number a salesperson typed here.
 */
export function customerFieldsFromEvent(data) {
  const fields = {};

  const company = pick(data, "company", "companyName", "company_name", "organisation", "organization", "name");
  if (company !== undefined) fields.company = String(company);

  const contact = pick(data, "contact", "contactName", "contact_name", "personName", "person", "fullName", "full_name");
  if (contact !== undefined) fields.contact = String(contact);

  const email = pick(data, "email", "emailAddress", "email_address");
  if (email !== undefined) fields.email = String(email);

  const phone = pick(data, "phone", "phoneNumber", "phone_number", "mobile", "contactNumber");
  if (phone !== undefined) fields.phone = String(phone);

  const city = pick(data, "city", "town");
  if (city !== undefined) fields.city = String(city);

  const state = pick(data, "state", "region");
  if (state !== undefined) fields.state = String(state);

  const country = pick(data, "country");
  if (country !== undefined) fields.country = String(country);

  const gstin = pick(data, "gstin", "gst", "gstNumber", "gst_number");
  if (gstin !== undefined) fields.gstin = String(gstin).toUpperCase();

  const source = pick(data, "source", "leadSource", "lead_source", "channel");
  fields.source = source !== undefined ? String(source) : "Website";

  const value = pick(data, "value", "amount", "dealValue", "deal_value", "estimatedValue");
  if (value !== undefined) {
    const n = Number(String(value).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n)) fields.value = n;
  }

  const currency = pick(data, "currency");
  if (currency !== undefined) fields.currency = String(currency).toUpperCase();

  const stage = normaliseStage(pick(data, "stage", "toStage", "to_stage", "status", "pipelineStage"));
  if (stage) fields.stage = stage;

  return fields;
}

/** A note for the activity timeline, from an `activity.logged` event. */
export function noteFromEvent(data, eventId, occurredAtMs) {
  const text = pick(data, "text", "note", "body", "message", "description", "comment");
  const kind = pick(data, "activityKind", "activity_kind", "kind", "type");
  const who = pick(data, "who", "user", "userName", "author", "loggedBy");
  const loggedAt = pick(data, "loggedAt", "logged_at", "ts", "timestamp");

  const ts = Number(loggedAt);
  return {
    /* Derived from the event id, so a retried delivery that slips past the
       dedupe table still cannot append the same note twice. */
    id: "web-" + eventId,
    ts: Number.isFinite(ts) && ts > 0 ? ts : occurredAtMs,
    user: who !== undefined ? String(who) : "Website",
    userId: "",
    text: text !== undefined ? String(text) : "",
    /* The CRM's own note kinds are a fixed list; anything else is a Note
       with the original kind kept in the text, rather than an unknown type
       that no filter on the Activity screen would ever match. */
    type: normaliseNoteType(kind),
  };
}

const NOTE_TYPES = ["Note", "Call", "Email", "Meeting", "WhatsApp", "Site Visit", "Demo"];

export function normaliseNoteType(value) {
  const clean = String(value ?? "").trim().toLowerCase();
  const match = NOTE_TYPES.find((t) => t.toLowerCase() === clean);
  return match ?? "Note";
}
