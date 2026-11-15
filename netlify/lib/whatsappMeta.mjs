import { metaError } from "./whatsappTemplates.mjs";
import { askAdminToAdd, whereSettingsLive } from "./whereSettingsLive.mjs";

/**
 * WhatsApp, straight from Meta's Cloud API.
 *
 * THE CREDENTIALS NEVER LEAVE THIS TIER. WHATSAPP_TOKEN and
 * WHATSAPP_PHONE_NUMBER_ID are read from the Function App's own environment
 * and used here; nothing is passed to the browser, nothing is written into
 * a record, and no screen is ever handed one. A browser that could send a
 * WhatsApp message directly could send any message to any number on the
 * company's account.
 *
 * TWO KINDS OF MESSAGE, and the difference is Meta's rule, not ours:
 *
 *   · a TEMPLATE, whose words were approved in advance. This is the only
 *     thing that may be sent to somebody who has not written to us in the
 *     last 24 hours — which is every automatic message this CRM sends.
 *   · FREE TEXT, which is allowed only inside the 24 hours after the
 *     customer's own last message. That is what the Inbox uses to answer a
 *     reply, and why it stops offering it when the window closes.
 *
 * WHAT COMES BACK FROM A SEND IS "ACCEPTED", NOT "DELIVERED". Meta answers
 * with a message id as soon as it has taken the message; delivered and read
 * arrive later on the webhook (netlify/functions/whatsapp-webhook.mjs), which
 * is what moves the row in the log on. Recording a send as "sent" is
 * therefore the honest word for what is known at that moment.
 */

const GRAPH = "https://graph.facebook.com/v25.0";

/** Configured at all? Lets callers choose this transport over the older one. */
export const metaConfigured = () =>
  !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

const credentials = () => ({
  token: process.env.WHATSAPP_TOKEN ?? "",
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  wabaId: process.env.WHATSAPP_WABA_ID ?? "",
});

/** The account's own details, for the template reader and the setup check. */
export const metaAccount = () => {
  const { token, wabaId } = credentials();
  return { token, wabaId };
};

/**
 * Digits only, with a country code — 91XXXXXXXXXX.
 *
 * Mirrors src/domain/integrations/phone.ts, because a number typed on a
 * customer record and a number used by the server have to reach the same
 * person. A leading zero is a domestic trunk prefix; a bare ten-digit
 * number is Indian, which is how every number in this CRM is typed.
 */
export function waNumber(value, defaultCountryCode = "91") {
  let digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = defaultCountryCode + digits;
  return digits;
}

export const looksSendable = (value) => /^\d{10,15}$/.test(waNumber(value));

/**
 * Post one message to the Cloud API.
 *
 * @returns {{ok: true, id: string|null, to: string} |
 *           {ok: false, error: string, retryable?: boolean, code?: number}}
 */
async function post(payload, { fetchImpl = fetch } = {}) {
  const { token, phoneNumberId } = credentials();
  if (!token || !phoneNumberId) {
    return {
      ok: false,
      error: "WhatsApp isn't connected. " + askAdminToAdd("WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID"),
    };
  }

  try {
    const resp = await fetchImpl(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    });
    const result = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const code = Number(result?.error?.code ?? 0);
      /* Meta's own wording is written for a developer — "(#132001) Template
         name does not exist in the translation". Logged in full; what comes
         back is something the person at the screen can act on. */
      console.error("whatsapp refused:", resp.status, code, metaError(result).slice(0, 300));
      return { ok: false, code, error: whyRefused(resp.status, code, result), retryable: isRetryable(resp.status, code) };
    }

    return {
      ok: true,
      id: result?.messages?.[0]?.id ?? null,
      /* Meta may correct the number it actually delivered to — a stored
         number with a stray prefix comes back normalised here, and the log
         should record where the message really went. */
      to: result?.contacts?.[0]?.wa_id ?? "",
    };
  } catch (err) {
    /* Nothing was handed over, so sending again cannot deliver it twice. */
    return { ok: false, retryable: true, error: `Could not reach WhatsApp. ${err?.message ?? ""}`.trim() };
  }
}

/** One approved template, with its blanks filled in order. */
export async function sendTemplate({ to, templateName, values = [], languageCode = "en" }, opts = {}) {
  const number = waNumber(to);
  if (!looksSendable(number)) {
    return { ok: false, error: "That number doesn't look like a WhatsApp number. It should be like 919810012345." };
  }
  if (!templateName) return { ok: false, error: "No WhatsApp template was named." };

  const parameters = values.map((v) => ({ type: "text", text: String(v ?? "") }));

  return post({
    to: number,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      /* The BODY component only. These templates have no header and no
         buttons that take variables; sending components a template does not
         declare is refused outright. */
      components: parameters.length ? [{ type: "body", parameters }] : [],
    },
  }, opts);
}

/** Free text. Only inside the 24-hour window — Meta refuses it outside. */
export async function sendText({ to, body, previewUrl = false }, opts = {}) {
  const number = waNumber(to);
  if (!looksSendable(number)) {
    return { ok: false, error: "That number doesn't look like a WhatsApp number. It should be like 919810012345." };
  }
  const text = String(body ?? "").trim();
  if (!text) return { ok: false, error: "There is no message to send." };
  if (text.length > 4096) return { ok: false, error: "WhatsApp messages are limited to 4,096 characters." };

  return post({ to: number, type: "text", text: { preview_url: !!previewUrl, body: text } }, opts);
}

/** Mark a customer's message as read, so they see the blue ticks. */
export async function markRead({ messageId }, opts = {}) {
  if (!messageId) return { ok: false, error: "No message id." };
  return post({ status: "read", message_id: String(messageId) }, opts);
}

/**
 * Something a person can do something about, instead of a code.
 *
 * The codes are Meta's documented ones. Each of these is a different job:
 * a bad token is an admin's, an unapproved template is whoever owns the
 * templates, and a closed 24-hour window is nobody's fault at all and must
 * not read like an error.
 */
function whyRefused(status, code, result) {
  const detail = metaError(result).toLowerCase();

  if (status === 401 || code === 190) {
    return `WhatsApp rejected the access token. Check WHATSAPP_TOKEN in ${whereSettingsLive()} — a temporary token expires after 24 hours.`;
  }
  if (code === 132000 || code === 132001 || detail.includes("template")) {
    return "WhatsApp does not have that template approved, or its wording now needs a different number of blanks. Check Settings → WhatsApp.";
  }
  if (code === 131047 || code === 131051 || detail.includes("re-engagement") || detail.includes("24")) {
    return "It is more than 24 hours since this customer last wrote, so only an approved template may be sent — not free text.";
  }
  /* THE FIRST ERROR ANYBODY MEETS. Until a WhatsApp number is verified for
     unrestricted sending, Meta only allows messages to numbers added to the
     test list in the app's own WhatsApp settings — so a first test to a
     colleague's phone fails with this and nothing explains why. */
  if (code === 131030 || detail.includes("not in allowed list")) {
    return "WhatsApp will only send to numbers on the test list until the business number is live. "
      + "Add this number under WhatsApp → API Setup in the Meta app, or finish verifying the number.";
  }
  if (code === 131026 || detail.includes("not a whatsapp user")) {
    return "That number is not on WhatsApp.";
  }
  if (code === 131031 || code === 368 || detail.includes("block")) {
    return "The WhatsApp account is restricted or this customer has blocked the business.";
  }
  if (code === 131056 || code === 130429 || status === 429) {
    return "WhatsApp is rate-limiting this account. The message was not sent; it can be tried again shortly.";
  }
  if (code === 131008 || detail.includes("param")) {
    return "WhatsApp refused the details filled into the template. A blank was empty or had a line break in it.";
  }
  return metaError(result) || "WhatsApp refused that message.";
}

/** Worth trying again later, as opposed to refused on its merits. */
function isRetryable(status, code) {
  if (status === 429 || status >= 500) return true;
  return code === 131056 || code === 130429 || code === 133016;
}
