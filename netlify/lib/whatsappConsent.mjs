import { TEMPLATES, autoKeyOf } from "./whatsappTemplates.mjs";
import { waNumber, looksSendable } from "./whatsappMeta.mjs";

/**
 * May this customer be sent this message, at all?
 *
 * EVERY SEND ASKS THIS, manual or automatic, and it is asked on the server
 * where the answer cannot be argued with. A browser deciding whether a
 * customer consented is a browser that can be wrong — or edited.
 *
 * THREE SEPARATE QUESTIONS, deliberately not collapsed into one boolean:
 *
 *   1. Did this customer agree to WhatsApp updates? Consent is the
 *      customer's, it is recorded on their record, and nothing overrides
 *      it — not an admin, not a switch, not somebody pressing the button.
 *   2. Is there a number to send to?
 *   3. For an AUTOMATIC message only: is that particular message switched
 *      on? A person pressing "Send WhatsApp" has already decided; the
 *      switches are about what happens without anybody watching.
 *
 * The answer carries a `reason` written for a salesperson, because the
 * screen shows it next to a disabled button and "false" explains nothing.
 */

/** Where the eight switches live in the settings row. */
export const WHATSAPP_SETTINGS_KEY = "whatsapp";

/**
 * The customer's WhatsApp number.
 *
 * Their WhatsApp field first; their ordinary phone when that is empty.
 * THE TICK IS THE CONSENT, not the field — somebody who ticks the box and
 * leaves the WhatsApp number blank means "message me", and a CRM that
 * silently sent nothing would look broken rather than careful. The number
 * used is always shown on screen and recorded on the log row.
 */
export function whatsappNumberOf(customer = {}) {
  const data = customer?.data ?? customer ?? {};
  const explicit = waNumber(data.whatsappPhone ?? data.whatsapp ?? "");
  if (looksSendable(explicit)) return explicit;
  const fallback = waNumber(data.phone ?? "");
  return looksSendable(fallback) ? fallback : "";
}

/** Did they agree? Absent means no: nobody is opted in by default. */
export function optedIn(customer = {}) {
  const data = customer?.data ?? customer ?? {};
  return data.whatsappOptIn === true;
}

/** The eight switches, as the settings row holds them. Absent means OFF. */
export function autoSwitches(settings = {}) {
  const block = settings?.[WHATSAPP_SETTINGS_KEY] ?? {};
  const auto = block?.auto ?? {};
  const out = {};
  for (const name of Object.keys(TEMPLATES)) out[TEMPLATES[name].auto] = auto[TEMPLATES[name].auto] === true;
  return out;
}

/** Is this particular automatic message switched on? */
export const autoEnabled = (settings, templateName) =>
  autoSwitches(settings)[autoKeyOf(templateName)] === true;

/**
 * Where a reply alert is emailed.
 *
 * A setting rather than a constant, so it can be changed without a deploy
 * when somebody else starts handling the inbox.
 */
export const alertEmailOf = (settings = {}, fallback = "") =>
  String(settings?.[WHATSAPP_SETTINGS_KEY]?.alertEmail ?? "").trim() || fallback;

/**
 * The whole question, answered once.
 *
 * @param {object} args
 * @param {object} args.customer   the customer record (or its `data`)
 * @param {object} args.settings   the company's settings row data
 * @param {string} args.template   which of the eight
 * @param {boolean} args.manual    true when a person pressed the button
 */
export function mayMessage({ customer, settings, template, manual = false }) {
  if (!TEMPLATES[template]) {
    return { ok: false, reason: `There is no WhatsApp template called ${template}.` };
  }

  if (!optedIn(customer)) {
    return {
      ok: false,
      reason: "This customer has not agreed to WhatsApp updates. Tick “WhatsApp updates allowed” on their record first.",
    };
  }

  const to = whatsappNumberOf(customer);
  if (!to) {
    return { ok: false, reason: "This customer has no WhatsApp number on file." };
  }

  /* A PERSON PRESSING SEND IS NOT AN AUTOMATIC MESSAGE. The switches
     decide what goes out unattended; they are not a mute button on the
     whole feature, and a salesperson who wants to send this customer their
     quotation now should not be told the admin has not enabled it. */
  if (!manual && !autoEnabled(settings, template)) {
    return {
      ok: false,
      reason: `Automatic “${TEMPLATES[template].label}” messages are switched off in Settings → WhatsApp.`,
      switchedOff: true,
    };
  }

  return { ok: true, reason: "", to };
}
