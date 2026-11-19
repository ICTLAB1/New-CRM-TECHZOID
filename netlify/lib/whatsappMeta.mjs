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

/**
 * Hand a PDF to Meta and get back the id that names it.
 *
 * WHY THE FILE GOES FIRST, AND NOT AS A LINK. A template's document header
 * can name either a public URL or a media id. A URL means a customer's
 * priced quotation sitting on the open web, fetchable by anyone who guesses
 * or is forwarded the address, with no sign-in and no expiry we control.
 * Uploading hands it only to Meta, and the id is useless to anybody else.
 *
 * Meta keeps an uploaded file for about thirty days, which is why the same
 * id can be reused for the follow-up three days later rather than the
 * quotation being rendered and uploaded twice.
 *
 * @returns {{ok: true, id: string} | {ok: false, error: string}}
 */
export async function uploadDocument({ bytes, filename }, opts = {}) {
  return uploadMedia({ bytes, filename: filename || "quotation.pdf", mimeType: "application/pdf" }, opts);
}

/**
 * Hand any file Meta accepts to Meta, and get back the id that names it.
 *
 * `uploadDocument` above is this with a quotation's PDF filled in — kept
 * as its own name because that is what every template send calls, and
 * because its refusals are worded about a quotation, which is what those
 * callers are sending.
 *
 * WHAT MAY BE UPLOADED IS NOT DECIDED HERE. whatsappMedia.mjs holds that,
 * and the caller asks it first. This hands over whatever it is given and
 * reports what Meta said about it.
 */
export async function uploadMedia({ bytes, filename, mimeType }, { fetchImpl = fetch } = {}) {
  const { token, phoneNumberId } = credentials();
  if (!token || !phoneNumberId) {
    return {
      ok: false,
      error: "WhatsApp isn't connected. " + askAdminToAdd("WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID"),
    };
  }
  const type = String(mimeType || "application/pdf");
  /* The quotation wording is kept for the quotation path, whose callers
     and tests are about a quotation and nothing else. */
  const what = type === "application/pdf" ? "quotation PDF" : "file";

  if (!bytes?.byteLength) {
    return { ok: false, error: `The ${what} came through empty, so there was nothing to attach.` };
  }

  /* META'S OWN CEILING, not the CRM's: whatsappMedia holds the much lower
     limits a reply is actually held to. Anything near this is a fault
     worth naming here rather than a timeout thirty seconds later. */
  if (bytes.byteLength > 95 * 1024 * 1024) {
    return { ok: false, error: `That ${what} is too large for WhatsApp to accept.` };
  }

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", type);
    form.append("file", new Blob([bytes], { type }), filename || "attachment");

    const resp = await fetchImpl(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/media`, {
      method: "POST",
      /* No Content-Type of our own: FormData sets it with the boundary. */
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const result = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      const code = Number(result?.error?.code ?? 0);
      console.error("whatsapp upload refused:", resp.status, code, metaError(result).slice(0, 300));
      return { ok: false, code, error: whyUploadRefused(resp.status, code, result, what) };
    }
    const id = String(result?.id ?? "");
    if (!id) return { ok: false, error: `WhatsApp accepted the ${what} but did not say where it put it.` };
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: `The ${what} could not be sent to WhatsApp. ${err?.message ?? ""}`.trim() };
  }
}

/** Why an upload was refused, in words somebody can act on. */
function whyUploadRefused(status, code, result, what = "quotation PDF") {
  const detail = metaError(result).toLowerCase();
  if (status === 401 || code === 190) {
    return `WhatsApp rejected the access token while uploading the ${what === "quotation PDF" ? "quotation" : what}. Check WHATSAPP_TOKEN in ${whereSettingsLive()}.`;
  }
  if (status === 413 || detail.includes("too large")) {
    return `That ${what} is too large for WhatsApp to accept.`;
  }
  if (detail.includes("type") || detail.includes("format")) {
    return what === "quotation PDF"
      ? "WhatsApp would not accept that file as a PDF."
      : "WhatsApp would not accept that kind of file.";
  }
  if (status === 429) {
    return "WhatsApp is rate-limiting uploads on this account. The message was not sent; try again shortly.";
  }
  return metaError(result) || `WhatsApp would not accept the ${what}.`;
}

/**
 * One approved template, with its blanks filled in order.
 *
 * `document` attaches a file that has already been uploaded — the header
 * component. A template that declares a header MUST be sent with one, and a
 * template that does not MUST NOT be, so the caller decides which template
 * it is sending and passes the document only with the one that takes it.
 */
export async function sendTemplate({ to, templateName, values = [], languageCode = "en", document = null }, opts = {}) {
  const number = waNumber(to);
  if (!looksSendable(number)) {
    return { ok: false, error: "That number doesn't look like a WhatsApp number. It should be like 919810012345." };
  }
  if (!templateName) return { ok: false, error: "No WhatsApp template was named." };

  const parameters = values.map((v) => ({ type: "text", text: String(v ?? "") }));

  /* THE HEADER COMES FIRST, as Meta's own examples have it. Sending a
     component a template does not declare is refused outright, which is why
     this is only ever present when the caller chose a template that takes
     one. */
  const components = [];
  if (document?.id) {
    components.push({
      type: "header",
      parameters: [{
        type: "document",
        document: { id: String(document.id), filename: String(document.filename || "quotation.pdf") },
      }],
    });
  }
  if (parameters.length) components.push({ type: "body", parameters });

  return post({
    to: number,
    type: "template",
    template: { name: templateName, language: { code: languageCode }, components },
  }, opts);
}

/**
 * A file that has already been uploaded, as its own message.
 *
 * Only inside the 24-hour window, like free text — this is a session
 * message, not a template, and Meta refuses it outside.
 *
 * THE FILENAME IS ONLY SENT WITH A DOCUMENT. Meta's image message has no
 * filename field, and sending a field a message type does not declare is
 * refused outright — the same rule that governs a template's header. The
 * customer sees a document's name on the file and an image in the chat,
 * which is the whole reason the two are different kinds.
 *
 * THE CAPTION IS THE TYPED MESSAGE. One message carrying the words and
 * the file together, the way a person sending this from their own phone
 * would — not a file followed by a separate line of text that may arrive
 * out of order, or not at all.
 */
export async function sendMedia({ to, kind, mediaId, filename = "", caption = "" }, opts = {}) {
  const number = waNumber(to);
  if (!looksSendable(number)) {
    return { ok: false, error: "That number doesn't look like a WhatsApp number. It should be like 919810012345." };
  }
  if (kind !== "image" && kind !== "document") {
    return { ok: false, error: `There is no way to send a “${kind}” on WhatsApp from here.` };
  }
  if (!mediaId) return { ok: false, error: "The file was not uploaded, so there is nothing to send." };

  const media = { id: String(mediaId) };
  const words = String(caption ?? "").trim();
  if (words) media.caption = words;
  if (kind === "document" && filename) media.filename = String(filename);

  return post({ to: number, type: kind, [kind]: media }, opts);
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

/**
 * Does Meta simply not have this template?
 *
 * 132001 is "template name does not exist in the translation", which is what
 * comes back both for a name Meta has never seen and for one still in
 * review. 132000 is a blank-count mismatch. Either way the answer is the
 * same: this name cannot be sent right now, so try the one it replaced.
 */
export function templateMissing(code, error = "") {
  if (code === 132001 || code === 132000) return true;
  const detail = String(error).toLowerCase();
  return detail.includes("does not exist") && detail.includes("template");
}

/** Worth trying again later, as opposed to refused on its merits. */
function isRetryable(status, code) {
  if (status === 429 || status >= 500) return true;
  return code === 131056 || code === 130429 || code === 133016;
}
