import { describe, expect, it } from "vitest";
import { signState, verifyState, STATE_TTL_MS } from "./state.mjs";
import { escapeHtml, resultPage } from "./html.mjs";
import { checkAttachment, emailList, isEmail, isGstin, isPan, str } from "./validate.mjs";
import { corsHeaders, clientIp, readJson } from "./http.mjs";
import { tooManyMessage } from "./ratelimit.mjs";
import {
  backoffMs, buildEnvelope, isValidEventKind, parseSignatureHeader, signBody,
  verifySignature, MAX_DELIVERY_ATTEMPTS, SIGNATURE_TOLERANCE_SECONDS,
} from "./webhookSign.mjs";
import {
  crmIdForWebsiteDeal, customerFieldsFromEvent, noteFromEvent, normaliseStage, websiteDealId,
} from "./inboundMap.mjs";
import { stopReason, TABLE_FOR } from "./followupRules.mjs";

const ENV = { MS_STATE_SECRET: "a-test-secret-value" };
const USER = "3f2a6c1e-0000-4000-8000-abcdef123456";

describe("OAuth state signing", () => {
  it("round-trips a user id", () => {
    const state = signState(USER, ENV);
    expect(verifyState(state, ENV)).toEqual({ ok: true, userId: USER });
  });

  it("rejects a forged state naming someone else", () => {
    // The attack this exists to stop: consent with your own Microsoft
    // account, hand back a state naming another CRM user, and from then on
    // their quotations send from your mailbox.
    const forged = Buffer.from(`${USER}.${Date.now()}.deadbeef.` + "0".repeat(64)).toString("base64url");
    expect(verifyState(forged, ENV).ok).toBe(false);
    expect(verifyState(forged, ENV).reason).toBe("signature");
  });

  it("rejects a state signed with a different secret", () => {
    const state = signState(USER, { MS_STATE_SECRET: "someone-elses-secret" });
    expect(verifyState(state, ENV).ok).toBe(false);
  });

  it("rejects a tampered user id even with the original signature", () => {
    const state = signState(USER, ENV);
    const decoded = Buffer.from(state, "base64url").toString("utf8");
    const swapped = decoded.replace(USER, "11111111-0000-4000-8000-abcdef123456");
    expect(verifyState(Buffer.from(swapped).toString("base64url"), ENV).ok).toBe(false);
  });

  it("expires after fifteen minutes", () => {
    const issued = Date.now();
    const state = signState(USER, ENV, issued);
    expect(verifyState(state, ENV, issued + STATE_TTL_MS - 1000).ok).toBe(true);
    expect(verifyState(state, ENV, issued + STATE_TTL_MS + 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a state dated in the future", () => {
    const state = signState(USER, ENV, Date.now() + 10 * 60_000);
    expect(verifyState(state, ENV).reason).toBe("future");
  });

  it("never throws on rubbish input", () => {
    for (const bad of ["", null, undefined, "!!!", "a.b", 42, {}]) {
      expect(() => verifyState(bad, ENV)).not.toThrow();
      expect(verifyState(bad, ENV).ok).toBe(false);
    }
  });

  it("issues a different state each time, so one cannot be recognised", () => {
    expect(signState(USER, ENV)).not.toBe(signState(USER, ENV));
  });

  it("refuses to sign without a secret configured", () => {
    expect(() => signState(USER, {})).toThrow();
    expect(verifyState("x", {}).ok).toBe(false);
  });
});

describe("HTML escaping on the callback page", () => {
  it("neutralises a script tag", () => {
    // v1 interpolated Microsoft's error_description — a query-string value —
    // straight into this page.
    expect(escapeHtml('<script>alert(1)</script>')).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes quotes and ampersands", () => {
    expect(escapeHtml(`"x" & 'y'`)).toBe("&quot;x&quot; &amp; &#39;y&#39;");
  });

  it("renders an attacker-supplied message harmlessly", () => {
    const page = resultPage("Connection cancelled", '<img src=x onerror="alert(1)">', false);
    expect(page).not.toContain("<img");
    expect(page).toContain("&lt;img");
  });

  it("escapes the title too", () => {
    expect(resultPage("<b>hi</b>", "ok", true)).not.toContain("<b>hi</b>");
  });

  it("handles null and undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("validation", () => {
  it("accepts and rejects email addresses", () => {
    expect(isEmail("rajesh@acme.co.in")).toBe(true);
    expect(isEmail("no-at-sign")).toBe(false);
    expect(isEmail("two@@at.com")).toBe(false);
    expect(isEmail("")).toBe(false);
  });

  it("validates a GSTIN by checksum, not just by shape", () => {
    // A shape-only check passes transposed digits, which is the error people
    // actually make.
    expect(isGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isGstin("07AAPFU0939F1ZX")).toBe(true);
    expect(isGstin("27AAPFU0939F1ZW")).toBe(false);
    expect(isGstin("72AAPFU0939F1ZV")).toBe(false);
    expect(isGstin("nonsense")).toBe(false);
  });

  it("accepts a lower-cased GSTIN", () => {
    expect(isGstin(" 27aapfu0939f1zv ")).toBe(true);
  });

  it("validates a PAN", () => {
    expect(isPan("AAPFU0939F")).toBe(true);
    expect(isPan("AAPFU0939")).toBe(false);
  });

  it("caps a string so an unbounded field cannot fill the database", () => {
    expect(str("x".repeat(500), 200)).toHaveLength(200);
    expect(str("  padded  ")).toBe("padded");
    expect(str(null)).toBe("");
  });

  it("cleans a CC list and names the invalid entry", () => {
    expect(emailList("a@b.com, c@d.com")).toEqual({ list: ["a@b.com", "c@d.com"], invalid: null });
    expect(emailList(["a@b.com", "nope"]).invalid).toBe("nope");
    expect(emailList("")).toEqual({ list: [], invalid: null });
  });
});

describe("attachments", () => {
  const base64 = Buffer.from("a PDF would go here").toString("base64");

  it("accepts a well-formed attachment", () => {
    const out = checkAttachment(base64, "quote.pdf");
    expect(out.ok).toBe(true);
    expect(out.attachment?.name).toBe("quote.pdf");
  });

  it("accepts no attachment at all", () => {
    expect(checkAttachment(undefined, undefined)).toEqual({ ok: true, attachment: null });
  });

  it("rejects contents without a name, and a name without contents", () => {
    expect(checkAttachment(base64, "").ok).toBe(false);
    expect(checkAttachment("", "quote.pdf").ok).toBe(false);
  });

  it("rejects something that is not base64", () => {
    expect(checkAttachment("not base64!!", "quote.pdf").ok).toBe(false);
  });

  it("rejects an attachment over the size cap, and says how big it was", () => {
    const huge = "A".repeat(12 * 1024 * 1024);
    const out = checkAttachment(huge, "huge.pdf");
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/MB/);
  });
});

describe("CORS", () => {
  const event = (origin) => ({ headers: { origin } });

  it("echoes a configured origin", () => {
    process.env.ALLOWED_ORIGINS = "https://crm.ttpldelhi.com,https://staging.example.com";
    expect(corsHeaders(event("https://crm.ttpldelhi.com"))["Access-Control-Allow-Origin"])
      .toBe("https://crm.ttpldelhi.com");
  });

  it("refuses an origin that is not configured", () => {
    process.env.ALLOWED_ORIGINS = "https://crm.ttpldelhi.com";
    expect(corsHeaders(event("https://evil.example"))["Access-Control-Allow-Origin"])
      .toBe("https://crm.ttpldelhi.com");
  });

  it("varies on Origin, so a proxy cannot cache one answer for everyone", () => {
    expect(corsHeaders(event("https://crm.ttpldelhi.com")).Vary).toBe("Origin");
  });

  it("never lets a response be cached", () => {
    expect(corsHeaders(event("x"))["Cache-Control"]).toBe("no-store");
  });
});

describe("request helpers", () => {
  it("reads a JSON body and returns null rather than throwing on rubbish", () => {
    expect(readJson({ body: '{"a":1}' })).toEqual({ a: 1 });
    expect(readJson({ body: "not json" })).toBeNull();
    expect(readJson({})).toEqual({});
  });

  it("finds the caller's IP behind the platform's proxy", () => {
    expect(clientIp({ headers: { "x-nf-client-connection-ip": "203.0.113.9" } })).toBe("203.0.113.9");
    expect(clientIp({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" } })).toBe("203.0.113.9");
    expect(clientIp({ headers: {} })).toBe("unknown");
  });

  it("phrases a rate limit in minutes", () => {
    expect(tooManyMessage(60)).toContain("1 minute");
    expect(tooManyMessage(600)).toContain("10 minutes");
  });
});

describe("webhook signing", () => {
  it("accepts only the five defined event kinds", () => {
    expect(isValidEventKind("deal.created")).toBe(true);
    expect(isValidEventKind("deal.stage_changed")).toBe(true);
    expect(isValidEventKind("deal.won")).toBe(true);
    expect(isValidEventKind("deal.lost")).toBe(true);
    expect(isValidEventKind("activity.logged")).toBe(true);
    expect(isValidEventKind("deal.deleted")).toBe(false);
    expect(isValidEventKind("")).toBe(false);
  });

  it("builds an envelope carrying a fresh id, the kind, a timestamp and the payload untouched", () => {
    const payload = { dealId: "c1", stage: "won" };
    const envelope = buildEnvelope("deal.won", payload, Date.parse("2026-08-24T12:00:00Z"));
    expect(envelope.kind).toBe("deal.won");
    expect(envelope.occurredAt).toBe("2026-08-24T12:00:00.000Z");
    expect(envelope.data).toEqual(payload);
    expect(envelope.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("gives two different envelopes for the same event two different ids", () => {
    const a = buildEnvelope("deal.created", { dealId: "c1" });
    const b = buildEnvelope("deal.created", { dealId: "c1" });
    expect(a.id).not.toBe(b.id);
  });

  it("carries a version, so the far end can tell formats apart later", () => {
    expect(buildEnvelope("deal.created", {}).version).toBe(1);
  });

  it("produces the documented t=<unix>,v1=<hex> header", () => {
    const at = Date.parse("2026-08-24T12:00:00Z");
    const header = signBody(JSON.stringify({ a: 1 }), "shh", at);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // `t` is whole seconds, not milliseconds — a receiver comparing it
    // against its own clock in seconds must not be out by a factor of 1000.
    expect(parseSignatureHeader(header)).toMatchObject({ t: Math.floor(at / 1000) });
  });

  it("signs deterministically — same body, secret and moment give the same signature", () => {
    const body = JSON.stringify({ kind: "deal.won", data: { dealId: "c1" } });
    const at = Date.parse("2026-08-24T12:00:00Z");
    expect(signBody(body, "shh", at)).toBe(signBody(body, "shh", at));
  });

  it("the same body signed a second later signs differently — the timestamp is inside the signature", () => {
    const body = JSON.stringify({ kind: "deal.won" });
    const at = Date.parse("2026-08-24T12:00:00Z");
    expect(signBody(body, "shh", at)).not.toBe(signBody(body, "shh", at + 1000));
  });

  it("round-trips: a body signed here verifies here", () => {
    const body = JSON.stringify({ kind: "deal.won", data: { dealId: "c1" } });
    const at = Date.parse("2026-08-24T12:00:00Z");
    expect(verifySignature(body, signBody(body, "shh", at), "shh", at)).toEqual({ ok: true });
  });

  it("rejects a body altered after signing", () => {
    const at = Date.parse("2026-08-24T12:00:00Z");
    const header = signBody(JSON.stringify({ amount: 100 }), "shh", at);
    const tampered = JSON.stringify({ amount: 999999 });
    expect(verifySignature(tampered, header, "shh", at).ok).toBe(false);
    expect(verifySignature(tampered, header, "shh", at).reason).toBe("signature");
  });

  it("rejects a signature made with someone else's secret", () => {
    const body = JSON.stringify({ kind: "deal.won" });
    const at = Date.parse("2026-08-24T12:00:00Z");
    expect(verifySignature(body, signBody(body, "guessed", at), "shh", at).ok).toBe(false);
  });

  it("rejects a replayed delivery once it is older than the tolerance", () => {
    // The attack this stops: capture a real "deal.won" delivery and send it
    // again later. The timestamp is inside the signed material, so it cannot
    // be moved forward without invalidating the signature.
    const body = JSON.stringify({ kind: "deal.won" });
    const at = Date.parse("2026-08-24T12:00:00Z");
    const header = signBody(body, "shh", at);
    const justInside = at + (SIGNATURE_TOLERANCE_SECONDS - 5) * 1000;
    const wellOutside = at + (SIGNATURE_TOLERANCE_SECONDS + 60) * 1000;
    expect(verifySignature(body, header, "shh", justInside).ok).toBe(true);
    expect(verifySignature(body, header, "shh", wellOutside)).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a future-dated delivery just as firmly as a stale one", () => {
    const body = JSON.stringify({ kind: "deal.won" });
    const at = Date.parse("2026-08-24T12:00:00Z");
    const header = signBody(body, "shh", at + 3600_000);
    expect(verifySignature(body, header, "shh", at).ok).toBe(false);
  });

  it("refuses everything when no secret is configured, rather than accepting anything", () => {
    const body = JSON.stringify({ kind: "deal.won" });
    expect(verifySignature(body, signBody(body, ""), "")).toEqual({ ok: false, reason: "unconfigured" });
  });

  it("treats a malformed or missing header as a rejection, never a partial match", () => {
    for (const header of ["", "garbage", "t=abc,v1=xyz", "v1=deadbeef", "t=123", null, undefined]) {
      expect(verifySignature("{}", header, "shh").ok, String(header)).toBe(false);
    }
    expect(parseSignatureHeader("t=123,v1=nothex!")).toBeNull();
  });

  it("backs off exponentially, doubling each attempt", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(MAX_DELIVERY_ATTEMPTS)).toBe(128_000);
  });
});

describe("mapping a website event onto a customer", () => {
  it("finds the website's deal id under any of the names it might use", () => {
    expect(websiteDealId({ dealId: "D1" })).toBe("D1");
    expect(websiteDealId({ deal_id: "D2" })).toBe("D2");
    expect(websiteDealId({ id: 42 })).toBe("42");
    expect(websiteDealId({ enquiryId: "E9" })).toBe("E9");
    expect(websiteDealId({ nothing: "here" })).toBeNull();
  });

  it("derives the same CRM row id every time, so a retry never duplicates a customer", () => {
    expect(crmIdForWebsiteDeal("D1")).toBe(crmIdForWebsiteDeal("D1"));
    expect(crmIdForWebsiteDeal("D1")).toBe("web-D1");
    expect(crmIdForWebsiteDeal("D1")).not.toBe(crmIdForWebsiteDeal("D2"));
  });

  it("strips anything unexpected out of an id rather than trusting it into a key", () => {
    expect(crmIdForWebsiteDeal("../../etc/passwd")).toBe("web-etcpasswd");
  });

  it("reads the fields a website plausibly sends, whatever it calls them", () => {
    expect(customerFieldsFromEvent({ companyName: "Acme Ltd", emailAddress: "a@b.com", mobile: "98765" }))
      .toMatchObject({ company: "Acme Ltd", email: "a@b.com", phone: "98765" });
    expect(customerFieldsFromEvent({ company: "Acme", email: "a@b.com", phone: "98765" }))
      .toMatchObject({ company: "Acme", email: "a@b.com", phone: "98765" });
  });

  it("returns only what the event supplied, so a merge cannot wipe fields it never mentioned", () => {
    // A stage-change event carrying no phone number must not erase the
    // phone number a salesperson typed into the CRM.
    const fields = customerFieldsFromEvent({ dealId: "D1", stage: "won" });
    expect(fields).not.toHaveProperty("phone");
    expect(fields).not.toHaveProperty("company");
    expect(fields.stage).toBe("won");
  });

  it("defaults the source to Website when the event doesn't say", () => {
    expect(customerFieldsFromEvent({}).source).toBe("Website");
    expect(customerFieldsFromEvent({ source: "Google Ads" }).source).toBe("Google Ads");
  });

  it("reads a money value written with symbols and separators", () => {
    expect(customerFieldsFromEvent({ value: "₹1,25,000" }).value).toBe(125000);
    expect(customerFieldsFromEvent({ amount: 4500 }).value).toBe(4500);
  });

  it("maps stage names onto the CRM's own, and leaves an unknown one alone", () => {
    expect(normaliseStage("won")).toBe("won");
    expect(normaliseStage("Closed Won")).toBe("won");
    expect(normaliseStage("NEW")).toBe("lead");
    expect(normaliseStage("enquiry")).toBe("lead");
    expect(normaliseStage("something we invented")).toBeNull();
  });

  it("builds a note whose id comes from the event, so a redelivery cannot double-post it", () => {
    const a = noteFromEvent({ text: "Called" }, "evt-1", 1000);
    const b = noteFromEvent({ text: "Called" }, "evt-1", 2000);
    expect(a.id).toBe(b.id);
    expect(a.text).toBe("Called");
  });

  it("files an unrecognised activity kind as a plain Note rather than a type no filter matches", () => {
    expect(noteFromEvent({ kind: "Call" }, "e", 0).type).toBe("Call");
    expect(noteFromEvent({ kind: "carrier-pigeon" }, "e", 0).type).toBe("Note");
  });
});

describe("whether the scheduler should still chase a document", () => {
  /* This rule is a deliberate second copy of `stopReason` in
     src/domain/followups/followups.ts — the scheduler is plain JavaScript
     and cannot import the app's TypeScript. Both are tested, so a change to
     one shows up as a failure on the other side. */
  const TODAY = "2026-08-24";

  it("carries on while the document is out with the customer", () => {
    expect(stopReason({ status: "Sent" }, TODAY)).toBeNull();
    expect(stopReason({ status: "Sent", validUntil: "2026-09-23" }, TODAY)).toBeNull();
    expect(stopReason({ status: "Issued" }, TODAY)).toBeNull();
  });

  it("stops the moment the customer has decided", () => {
    // The worst thing this feature could do is chase somebody for a decision
    // they already gave.
    expect(stopReason({ status: "Accepted" }, TODAY)).toBe("the customer accepted it");
    expect(stopReason({ status: "Rejected" }, TODAY)).toBe("the customer turned it down");
  });

  it("treats a lapsed validity as expired however the row is marked", () => {
    // A quotation still marked "Sent" whose validity ran out yesterday has
    // expired. Chasing it asks the customer to accept something that is gone.
    expect(stopReason({ status: "Sent", validUntil: "2026-08-23" }, TODAY)).toBe("it has expired");
  });

  it("does not call a quotation expired on its last valid day", () => {
    expect(stopReason({ status: "Sent", validUntil: "2026-08-24" }, TODAY)).toBeNull();
  });

  it("stops on a status it does not recognise rather than guessing", () => {
    expect(stopReason({ status: "Cancelled" }, TODAY)).toBe("its status is now Cancelled");
    expect(stopReason({}, TODAY)).toBe("it is back to a draft");
    expect(stopReason(null, TODAY)).toBe("it is back to a draft");
  });

  it("knows which table each kind of document lives in", () => {
    expect(TABLE_FOR.quotation).toBe("quotes");
    expect(TABLE_FOR.proforma).toBe("proformas");
    // Anything else is not followed up, and the scheduler stops rather than
    // reading a table that does not exist.
    expect(TABLE_FOR.invoice).toBeUndefined();
  });
});
