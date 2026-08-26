import { randomUUID } from "node:crypto";
import { clientIp, fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient } from "../lib/auth.mjs";
import { isEmail, isGstin, isPan, str } from "../lib/validate.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { resolveRef } from "../lib/leadRef.mjs";

/**
 * The public customer registration form.
 *
 * INTENTIONALLY UNAUTHENTICATED — anyone with a salesperson's link may submit
 * — which is why it is the endpoint that most needs a rate limit and strict
 * bounds on every field. v1 had the bounds but no limit.
 *
 * The lead is filed to the person whose link was used: `ref` identifies a
 * salesperson, the enquiry lands in their pipeline, and it is checked against
 * a real profile so a made-up id cannot plant rows.
 */

/** Matches SEGMENTS in src/domain/pipeline/stages.ts. Anything else is
 *  ignored rather than stored: this field feeds reports, and a segment
 *  nobody recognises quietly becomes its own category. */
const SEGMENTS = ["SMB", "Mid-Market", "Enterprise", "Government / PSU", "Education"];

/** The workspace's own fields, as answered. Ids are matched loosely and
 *  values bounded — this is an unauthenticated endpoint, and the shape of
 *  what arrives is entirely up to whoever posts it. */
function cleanCustomFields(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw).slice(0, 8)) {
    const id = str(key, 64);
    const text = str(value, 300);
    if (id && text) out[id] = text;
  }
  return out;
}

const MAX = {
  company: 200, contact: 120, designation: 100, email: 200, phone: 40,
  gstin: 15, pan: 10, address: 300, city: 100, state: 100, country: 100,
  pincode: 12, message: 2000,
};

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const body = readJson(event);
  if (!body) return fail(event, 400, "That submission wasn't valid.");

  /* The honeypot: a field a real person never sees, so a value here is a
     bot. Answer 200 so it learns nothing, and store nothing. */
  if (str(body.website, 200)) {
    console.log("honeypot triggered from", clientIp(event));
    return json(event, 200, { ok: true });
  }

  const refId = str(body.refId, 64);
  const company = str(body.company, MAX.company);
  const contact = str(body.contact, MAX.contact);
  const email = str(body.email, MAX.email);
  const phone = str(body.phone, MAX.phone);

  if (!refId) return fail(event, 400, "This link looks incomplete. Please ask for a fresh one.");
  if (!company) return fail(event, 400, "Company / organisation name is required.");
  if (!contact) return fail(event, 400, "Contact person's name is required.");
  if (!email && !phone) return fail(event, 400, "Please provide at least an email or phone number so we can reach you.");
  if (email && !isEmail(email)) return fail(event, 400, "That email address doesn't look valid.");

  const gstin = str(body.gstin, MAX.gstin).toUpperCase();
  /* Verified server-side with the full checksum. The form checks too, but a
     client check is a convenience — anyone can post here directly. */
  if (gstin && !isGstin(gstin)) {
    return fail(event, 400, "That GSTIN doesn't look right — please double-check it and try again.");
  }
  const pan = str(body.pan, MAX.pan).toUpperCase();
  if (pan && !isPan(pan)) {
    return fail(event, 400, "That PAN doesn't look right — it should be 10 characters, e.g. AAAAA0000A.");
  }

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "Something went wrong submitting your details. Please try again in a moment.", err?.message);
  }

  const rl = await consume(admin, "submit-lead", clientIp(event));
  if (!rl.allowed) {
    return fail(event, 429, tooManyMessage(rl.retryAfterSeconds) + " If this is urgent, please email us directly.");
  }

  /* Only a real, current profile may receive leads — resolved from either
     shape of link. See ../lib/leadRef.mjs. */
  let ownerId;
  try {
    ownerId = await resolveRef(admin, refId);
    if (!ownerId) return fail(event, 400, "This link is no longer valid. Please ask for a fresh one.");
  } catch (err) {
    return fail(event, 500, "Something went wrong submitting your details. Please try again in a moment.", err?.message);
  }

  const id = randomUUID();
  const now = Date.now();
  const message = str(body.message, MAX.message);

  /* The same allocator the app uses, for the same reason: this runs on a
     server with nobody watching, and a customer ID handed out twice here is
     one that would never be noticed. Postgres settles it. A failure is not
     fatal — a customer who has just filled in a form must not be turned away
     because a counter would not advance. */
  let code = "";
  try {
    const { data } = await admin.rpc("next_customer_code");
    code = data ? String(data) : "";
  } catch (err) {
    console.error("could not allocate a customer code:", err?.message ?? err);
  }

  /* The shape here is the customer record the whole CRM reads. Every field
     the app expects is written, including the empty ones: a record missing
     `customFields` or `notes` is the "legacy record" problem being created
     fresh rather than inherited. */
  const country = str(body.country, MAX.country) || "India";
  const isIndia = country === "India";

  const record = {
    code,
    company, contact,
    designation: str(body.designation, MAX.designation),
    email, phone, gstin, pan,
    address: str(body.address, MAX.address),
    city: str(body.city, MAX.city),
    state: str(body.state, MAX.state),
    country,
    pincode: str(body.pincode, MAX.pincode),
    segment: SEGMENTS.includes(str(body.segment, 40)) ? str(body.segment, 40) : "SMB",
    /* NEVER SET BEFORE, AND IT SHOWED. Without these a lead from the form
       reached the app with no currency and no tax regime, so the first
       quotation raised for an overseas customer carried the workspace
       default — Indian rupees and GST — until somebody noticed. They are
       derived from the country here, exactly as the app derives them. */
    currency: isIndia ? "INR" : "",
    taxType: isIndia ? "gst" : "none",
    source: "Customer Registration Form",
    stage: "lead",
    value: "",
    nextFollowUp: "",
    wonAt: null,
    notes: message
      ? [{ id: randomUUID(), ts: now, user: "Registration form", text: message, type: "Note" }]
      : [],
    customFields: cleanCustomFields(body.customFields),
    createdAt: now,
    updatedAt: now,
  };

  try {
    const { error } = await admin.from("customers").insert({
      id,
      owner_id: ownerId,
      data: record,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (err) {
    return fail(event, 500, "Something went wrong submitting your details. Please try again in a moment.", err?.message);
  }

  return json(event, 200, { ok: true });
}
