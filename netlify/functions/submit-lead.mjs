import { randomUUID } from "node:crypto";
import { clientIp, fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient } from "../lib/auth.mjs";
import { isEmail, isGstin, isPan, str } from "../lib/validate.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";

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

  /* Only a real, current profile may receive leads. */
  try {
    const { data: owner } = await admin.from("profiles").select("id").eq("id", refId).maybeSingle();
    if (!owner) return fail(event, 400, "This link is no longer valid. Please ask for a fresh one.");
  } catch (err) {
    return fail(event, 500, "Something went wrong submitting your details. Please try again in a moment.", err?.message);
  }

  const id = randomUUID();
  const now = Date.now();
  const message = str(body.message, MAX.message);

  /* The shape here is the customer record the whole CRM reads. Every field
     the app expects is written, including the empty ones: a record missing
     `customFields` or `notes` is the "legacy record" problem being created
     fresh rather than inherited. */
  const record = {
    company, contact,
    designation: str(body.designation, MAX.designation),
    email, phone, gstin, pan,
    address: str(body.address, MAX.address),
    city: str(body.city, MAX.city),
    state: str(body.state, MAX.state),
    country: str(body.country, MAX.country) || "India",
    pincode: str(body.pincode, MAX.pincode),
    segment: "SMB",
    source: "Customer Registration Form",
    stage: "lead",
    value: "",
    nextFollowUp: "",
    wonAt: null,
    notes: message
      ? [{ id: randomUUID(), ts: now, user: "Registration form", text: message, type: "Note" }]
      : [],
    customFields: {},
    createdAt: now,
    updatedAt: now,
  };

  try {
    const { error } = await admin.from("customers").insert({
      id,
      owner_id: refId,
      data: record,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (err) {
    return fail(event, 500, "Something went wrong submitting your details. Please try again in a moment.", err?.message);
  }

  return json(event, 200, { ok: true });
}
