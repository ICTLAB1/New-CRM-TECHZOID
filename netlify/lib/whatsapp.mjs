/**
 * Sending one approved WhatsApp template through Interakt.
 *
 * Interakt fronts the WhatsApp Business Cloud API. Everything this file
 * sends is a TEMPLATE, because an automatic follow-up arrives days after
 * the last contact and so falls outside Meta's 24-hour customer-service
 * window — out there, only templates approved in advance may be sent. A
 * free-form message to a cold thread is refused, and no amount of retrying
 * changes that.
 *
 * WHAT IS DECIDED ELSEWHERE. Which template, what goes in its placeholders,
 * and how a phone number splits into a country code and a national number
 * are all settled when the follow-up is queued — in
 * src/domain/integrations/interakt.ts, which is tested. This file posts what
 * it is given. That is deliberate: a mis-split number does not fail loudly,
 * it delivers a customer's quotation reminder to a stranger, so the rule
 * lives in one place with tests rather than in two.
 *
 * `to` arrives as "<country code> <national number>", e.g. "+91 9810012345",
 * already split by the code that queued it. Splitting on the space keeps
 * this file free of any opinion about phone numbers at all.
 */

const ENDPOINT = "https://api.interakt.ai/v1/public/message/";

/**
 * @returns {{ok: true, id: string|null} | {ok: false, error: string, retryable?: boolean}}
 */
export async function sendWhatsAppTemplate({ to, templateName, bodyValues, languageCode = "en", callbackData = "" }) {
  const key = process.env.INTERAKT_API_KEY;
  if (!key) {
    return {
      ok: false,
      error: "WhatsApp isn't connected. Ask an admin to add INTERAKT_API_KEY in Netlify.",
    };
  }

  const [countryCode, phoneNumber] = String(to ?? "").trim().split(/\s+/);
  if (!countryCode || !phoneNumber) {
    return { ok: false, error: "That follow-up has no usable phone number on it." };
  }
  if (!templateName) {
    return { ok: false, error: "No WhatsApp template name is set for this follow-up." };
  }

  try {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        /* Interakt's dashboard hands out a key that is already base64 —
           it goes into the header as-is, NOT re-encoded. */
        Authorization: "Basic " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        countryCode,
        phoneNumber,
        callbackData: String(callbackData ?? "").slice(0, 200),
        type: "Template",
        template: {
          name: templateName,
          languageCode,
          bodyValues: (bodyValues ?? []).map((v) => String(v ?? "")),
        },
      }),
    });

    const result = await resp.json().catch(() => ({}));

    if (!resp.ok || result?.result === false) {
      /* Interakt's own wording is aimed at a developer ("template not found
         in the waba"). Logged in full; what comes back is what a
         salesperson can act on. */
      console.error("interakt refused:", resp.status, JSON.stringify(result).slice(0, 400));
      return {
        ok: false,
        error: whyRefused(resp.status, result),
      };
    }

    /* ACCEPTED, NOT DELIVERED. Interakt answers as soon as it has taken the
       message; whether WhatsApp actually delivered it arrives later on a
       webhook. Recording this as "sent" is therefore honest about exactly
       what is known — the message left this company. */
    return { ok: true, id: result?.id ?? null };
  } catch (err) {
    /* Nothing was handed over, so trying again tomorrow cannot deliver it
       twice. */
    return { ok: false, retryable: true, error: "Could not reach WhatsApp. " + (err?.message ?? "") };
  }
}

/** Something a person can do something about, from something they cannot. */
function whyRefused(status, result) {
  const detail = String(result?.message ?? result?.error ?? "").toLowerCase();
  if (status === 401 || status === 403) {
    return "WhatsApp rejected the account key. Check INTERAKT_API_KEY in Netlify against the key in Interakt.";
  }
  if (detail.includes("template")) {
    return "WhatsApp does not have a template by that name approved. Check the template names in Settings → Follow-ups against Interakt.";
  }
  if (detail.includes("opt") || detail.includes("block")) {
    return "This customer's number cannot be messaged — they may have blocked the business or never opted in.";
  }
  return "WhatsApp refused that message. Interakt's log will say why.";
}
