/**
 * IndiaMART leads, turned into CRM customers.
 *
 * Kept free of network and database calls so the whole mapping is testable
 * against real captured payloads — the same split as inboundMap.mjs, and for
 * the same reason: the part that goes wrong quietly is the field mapping,
 * not the HTTP.
 *
 * ONE MAPPING SERVES BOTH DIRECTIONS. IndiaMART offers a Pull API you poll
 * and a Push webhook they call, and the lead object is the same 22 fields in
 * both — the only difference is that Pull returns RESPONSE as an array and
 * Push as a single object. `leadsFrom` flattens that difference so nothing
 * downstream has to care which arrived.
 *
 * WHY BOTH ARE WORTH HAVING. Push is fast but IndiaMART documents no retry,
 * no ordering and no delivery guarantee, so a listener that is down for ten
 * minutes loses those leads for good. Pull is slower but authoritative and
 * can be re-run over any window in the last year. So Push is an accelerator
 * and Pull is the safety net, both funnelling into one upsert keyed on
 * UNIQUE_QUERY_ID — a missed push heals itself on the next poll.
 *
 * NOTHING IS ASSUMED PRESENT. The field set has grown over the years: a
 * response captured in 2022 carries 19 of the 22 fields, with SUBJECT,
 * SENDER_PINCODE and QUERY_MCAT_NAME simply absent. Every read here is
 * optional and defaults to blank. Blank itself arrives as "" rather than
 * null, and a lead with no email address at all is ordinary.
 */

/* ── what comes back ───────────────────────────────────────────────── */

/**
 * IndiaMART answers 200 for most things and puts the real outcome in CODE,
 * so the body decides, not the status line.
 *
 * 204 IS NOT AN ERROR. "There are no leads in the given time duration" is
 * the single most common answer a five-minute poller gets, and treating it
 * as a failure would mean an error every five minutes forever.
 */
export function classify(status, body) {
  const code = String(body?.CODE ?? (status === 200 ? "" : status));
  const message = String(body?.MESSAGE ?? "");

  if (code === "200") {
    return { ok: true, leads: leadsFrom(body), code, message };
  }
  if (code === "204") {
    /* Nothing to fetch. The window still advances — see the poller. */
    return { ok: true, leads: [], code, message, empty: true };
  }
  if (code === "429") {
    return { ok: false, retry: true, code, message, reason: "rate-limited" };
  }
  if (code === "401") {
    /* Wrong key, or a key that expired through disuse. Both need a person:
       the fix is to generate a new one in the seller panel. */
    return { ok: false, retry: false, code, message, reason: "bad-key" };
  }
  if (code === "400") {
    return { ok: false, retry: false, code, message, reason: "bad-request" };
  }
  if (code === "500" || status >= 500) {
    return { ok: false, retry: true, code, message, reason: "their-fault" };
  }
  return { ok: false, retry: false, code, message, reason: "unrecognised" };
}

/** RESPONSE is an array from the Pull API and a single object from Push. */
export function leadsFrom(body) {
  const r = body?.RESPONSE;
  if (Array.isArray(r)) return r.filter((x) => x && typeof x === "object");
  if (r && typeof r === "object") return [r];
  return [];
}

/* ── asking for a window ───────────────────────────────────────────── */

/**
 * The timestamp format IndiaMART's own worked example uses: a three-letter
 * English month and NO separator before the hour — 06-Sep-202614:30:00.
 *
 * WHY THIS ONE. Their documentation labels the timestamp form
 * "DD-MM-YYYYHH:MM:SS" with a numeric month, and then prints an example
 * with an alphabetic one. Rather than trust a label that disagrees with the
 * example beside it, this follows the shape that working integrations
 * actually send to the live API. The first live call logs what came back,
 * so a wrong guess shows up as a logged CODE 400 rather than as leads that
 * quietly never arrive.
 *
 * Always IST, because their clock is IST and the window is theirs.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function imTimestamp(date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(date).map((x) => [x.type, x.value]),
  );
  const month = MONTHS[Number(p.month) - 1];
  /* Intl gives "24" for midnight in some engines; IndiaMART wants "00". */
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.day}-${month}-${p.year}${hour}:${p.minute}:${p.second}`;
}

/** Their limits, as documented. Both are hard: a wider window is refused,
 *  and nothing older than a year exists to ask for. */
export const MAX_WINDOW_DAYS = 7;
export const MAX_HISTORY_DAYS = 365;

/** The minimum gap between calls. Going faster earns CODE 429; more than
 *  five calls in one minute disables the key for fifteen. */
export const MIN_GAP_SECONDS = 300;

/**
 * The window to ask for next.
 *
 * OVERLAPS ON PURPOSE. Asking from exactly where the last poll finished
 * loses any lead IndiaMART recorded a moment after our clock said the
 * window closed. Five minutes of overlap means every lead is fetched at
 * least twice and never zero times; the duplicates cost nothing because the
 * upsert is keyed on their id.
 */
export function windowFor(now, since, overlapSeconds = 300) {
  const end = now;
  const earliest = new Date(now.getTime() - MAX_HISTORY_DAYS * 86400_000);
  const widest = new Date(now.getTime() - MAX_WINDOW_DAYS * 86400_000);

  let start = since ? new Date(since.getTime() - overlapSeconds * 1000) : widest;
  if (start < widest) start = widest;
  if (start < earliest) start = earliest;
  if (start > end) start = new Date(end.getTime() - overlapSeconds * 1000);

  return { start, end, startParam: imTimestamp(start), endParam: imTimestamp(end) };
}

export function pullUrl(key, window) {
  return "https://mapi.indiamart.com/wservce/crm/crmListing/v2/"
    + "?glusr_crm_key=" + encodeURIComponent(key)
    + "&start_time=" + encodeURIComponent(window.startParam)
    + "&end_time=" + encodeURIComponent(window.endParam);
}

/* ── one lead, mapped ──────────────────────────────────────────────── */

const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** Their id. Numeric, and sometimes arrives unquoted, so it is forced to a
 *  string before it is ever used as a key. */
export const queryId = (lead) => str(lead?.UNIQUE_QUERY_ID);

/** The CRM row id, derived from theirs rather than random, so the same lead
 *  arriving from Push and again from Pull lands on ONE row. */
export const crmIdFor = (id) => "im-" + String(id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);

/**
 * A phone number somebody can dial.
 *
 * IndiaMART sends "+91-9999999999" — a country code, a literal hyphen, then
 * the number — and landlines as "0120-2222222", which is a different shape
 * again. The CRM's own duplicate check compares the last ten digits, so
 * storing ten digits for an Indian number makes a lead match a customer who
 * is already on file. Anything that is not ten digits is kept as it came:
 * mangling an international number is worse than leaving it long.
 */
export function tidyPhone(raw) {
  const value = str(raw);
  if (!value) return "";
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 10) return digits;
  if (digits.length > 10 && (value.startsWith("+91") || digits.startsWith("91"))) {
    const last10 = digits.slice(-10);
    /* Only when what remains looks like an Indian mobile. A landline with
       an STD code is not improved by having its code cut off. */
    if (/^[6-9]/.test(last10)) return last10;
  }
  return value;
}

/** QUERY_MESSAGE is HTML with bare carriage returns — <br> tags, and the
 *  buyer's requirements flattened into the text. Rendered raw it is a mess
 *  and, in the wrong pane, a script injection. */
export function plainText(raw) {
  return str(raw)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** SENDER_ADDRESS is unparsed free text and often carries the pincode when
 *  SENDER_PINCODE is missing. Six digits on their own, not part of a longer
 *  run — a phone number in the address must not become a pincode. */
export function pincodeIn(address) {
  const m = str(address).match(/(?<![0-9])([1-9][0-9]{5})(?![0-9])/);
  return m ? m[1] : "";
}

/** Their enquiry types. W and B and P are documented; the rest are reported
 *  by integrators without an official source, so they are labelled but an
 *  unknown code is passed through rather than forced into one of these. */
const QUERY_TYPES = {
  W: "Direct enquiry",
  B: "Buy lead",
  P: "Phone call",
  BIZ: "Catalog view",
  WA: "WhatsApp enquiry",
};

export const queryTypeLabel = (code) => QUERY_TYPES[str(code).toUpperCase()] || "Enquiry";

/**
 * The customer fields one lead carries.
 *
 * Returns ONLY what the lead actually supplied, never a full record padded
 * with blanks, so merging this over an existing customer cannot wipe what a
 * salesperson typed. The same rule inboundMap.mjs follows, and it matters
 * more here: every poll re-fetches the same leads on purpose.
 */
export function customerFieldsFrom(lead) {
  const fields = {};
  const set = (key, value) => { if (value) fields[key] = value; };

  /* A record with no company name is unreadable in a list, and a great many
     IndiaMART buyers are individuals with no company at all — so the
     person's name stands in rather than leaving the row blank. */
  set("company", str(lead.SENDER_COMPANY) || str(lead.SENDER_NAME));
  set("contact", str(lead.SENDER_NAME));
  set("email", str(lead.SENDER_EMAIL) || str(lead.SENDER_EMAIL_ALT));
  set("phone", tidyPhone(lead.SENDER_MOBILE) || tidyPhone(lead.SENDER_PHONE));

  const alt = tidyPhone(lead.SENDER_MOBILE_ALT) || tidyPhone(lead.SENDER_PHONE_ALT);
  if (alt && alt !== fields.phone) set("altPhone", alt);

  set("address", str(lead.SENDER_ADDRESS));

  /* City and state occasionally arrive holding a pincode instead of a name.
     Better blank than a customer in the city of 500072. */
  const city = str(lead.SENDER_CITY);
  if (city && !/^[0-9]{6}$/.test(city)) set("city", city);
  const state = str(lead.SENDER_STATE);
  if (state && !/^[0-9]{6}$/.test(state)) set("state", state);

  set("pincode", str(lead.SENDER_PINCODE) || pincodeIn(lead.SENDER_ADDRESS));
  if (str(lead.SENDER_COUNTRY_ISO).toUpperCase() === "IN") set("country", "India");

  return fields;
}

/**
 * The enquiry itself, as a note on the customer's timeline.
 *
 * The fields that matter to a salesperson — what they asked for and what
 * they said — are not customer attributes, they are a conversation. Putting
 * them in the timeline is what makes a second enquiry from the same buyer
 * show up as history rather than overwriting the first.
 */
export function noteFrom(lead) {
  const parts = [];
  const product = str(lead.QUERY_PRODUCT_NAME) || str(lead.QUERY_MCAT_NAME);
  if (product) parts.push(`Product: ${product}`);
  const subject = str(lead.SUBJECT);
  if (subject && subject !== product) parts.push(subject);
  const message = plainText(lead.QUERY_MESSAGE);
  if (message) parts.push(message);
  if (str(lead.CALL_DURATION)) parts.push(`Call lasted ${str(lead.CALL_DURATION)}.`);

  return {
    id: "im-" + queryId(lead),
    ts: queryTimeMs(lead),
    user: "IndiaMART",
    userId: "",
    type: "enquiry",
    text: parts.join("\n\n") || `${queryTypeLabel(lead.QUERY_TYPE)} from IndiaMART.`,
  };
}

/** QUERY_TIME is "2022-09-17 09:34:45" in IST — a different format from the
 *  one they want in start_time, which is worth saying out loud because
 *  reusing the wrong one silently shifts every lead by five and a half
 *  hours. */
export function queryTimeMs(lead) {
  const raw = str(lead.QUERY_TIME);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return Date.now();
  /* IST is +05:30 and has no daylight saving, so the offset is a constant
     and not something that needs a timezone library. */
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+05:30`) || Date.now();
}
