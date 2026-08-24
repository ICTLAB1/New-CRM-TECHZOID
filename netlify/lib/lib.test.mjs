import { describe, expect, it } from "vitest";
import { signState, verifyState, STATE_TTL_MS } from "./state.mjs";
import { escapeHtml, resultPage } from "./html.mjs";
import { checkAttachment, emailList, isEmail, isGstin, isPan, str } from "./validate.mjs";
import { corsHeaders, clientIp, readJson } from "./http.mjs";
import { tooManyMessage } from "./ratelimit.mjs";
import { backoffMs, buildEnvelope, isValidEventKind, signBody, MAX_DELIVERY_ATTEMPTS } from "./webhookSign.mjs";

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

  it("signs deterministically — the same body and secret always produce the same signature", () => {
    const body = JSON.stringify({ kind: "deal.won", data: { dealId: "c1" } });
    expect(signBody(body, "shh")).toBe(signBody(body, "shh"));
  });

  it("a different secret or a different body changes the signature", () => {
    const body = JSON.stringify({ kind: "deal.won" });
    const sig = signBody(body, "shh");
    expect(signBody(body, "different-secret")).not.toBe(sig);
    expect(signBody(JSON.stringify({ kind: "deal.lost" }), "shh")).not.toBe(sig);
  });

  it("signature is 64 lowercase hex characters — a SHA-256 HMAC", () => {
    expect(signBody("x", "shh")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("backs off exponentially, doubling each attempt", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(MAX_DELIVERY_ATTEMPTS)).toBe(128_000);
  });
});
