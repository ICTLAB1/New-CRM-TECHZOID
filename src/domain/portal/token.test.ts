import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  hashPortalToken, isPortalUrl, linkState, looksLikeToken, newPortalToken, portalLink, readPortalToken,
} from "./token";

describe("the secret in a portal link", () => {
  it("is 256 bits, url-safe, and never the same twice", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const token = newPortalToken();
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });

  /* THE ONE THAT MATTERS. The browser stores a hash; the server recomputes it
     from the token in the URL and looks the row up by it. If these two ever
     compute it differently, every link in the field stops working. */
  it("hashes exactly as the server does", async () => {
    for (const token of [newPortalToken(), newPortalToken(), "a".repeat(43)]) {
      const here = await hashPortalToken(token);
      const there = createHash("sha256").update(token, "utf8").digest("hex");
      expect(here).toBe(there);
      expect(here).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("agrees with the database's own check constraint on the hash", async () => {
    /* supabase/021_portal_tokens.sql: token_hash ~ '^[0-9a-f]{64}$' */
    expect(await hashPortalToken(newPortalToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("reading a portal link", () => {
  it("finds the token", () => {
    const token = newPortalToken();
    expect(readPortalToken({ search: `?portal=${token}` })).toBe(token);
  });

  it("is not a portal link without one", () => {
    expect(readPortalToken({ search: "" })).toBe("");
    expect(readPortalToken({ search: "?lead=K7QM2P" })).toBe("");
  });

  /* A malformed token never reaches the network: the page says "ask for a
     fresh link" without a request, and a probe costs nothing to refuse. */
  it("refuses rubbish before it becomes a request", () => {
    expect(readPortalToken({ search: "?portal=short" })).toBe("");
    expect(readPortalToken({ search: "?portal=" + "x".repeat(400) })).toBe("");
    expect(looksLikeToken("' or 1=1 --")).toBe(false);
  });

  it("builds a link without doubling the slash", () => {
    expect(portalLink("https://crm.ttpldelhi.com/", "abc")).toBe("https://crm.ttpldelhi.com/?portal=abc");
  });
});

describe("whether a link still works", () => {
  const now = Date.UTC(2026, 2, 10);
  const iso = (offsetDays: number) => new Date(now + offsetDays * 86400000).toISOString();

  it("is live until it expires", () => {
    expect(linkState({ revokedAt: null, expiresAt: iso(1) }, now)).toBe("live");
    expect(linkState({ revokedAt: null, expiresAt: iso(-1) }, now)).toBe("expired");
  });

  it("counts as revoked even if it had not expired", () => {
    expect(linkState({ revokedAt: iso(-2), expiresAt: iso(10) }, now)).toBe("revoked");
  });
});

describe("a link that arrived broken", () => {
  /* THE BUG THIS PINS. A mail client wrapped a portal link across two lines,
     so the browser received `?portal=Xk3p_Q`. The app routed on the token
     being VALID, so an invalid one was not a portal link at all — and the
     customer landed on the sign-in screen of a CRM they have no account for.
     Presence and validity are two different questions and now have two
     different functions. */
  it("is still a portal link, even truncated", () => {
    expect(isPortalUrl({ search: "?portal=Xk3p_Q" })).toBe(true);
    expect(readPortalToken({ search: "?portal=Xk3p_Q" })).toBe("");
  });

  it("is a portal link even with the token missing entirely", () => {
    expect(isPortalUrl({ search: "?portal=" })).toBe(true);
  });

  it("and a page that is not one is left alone", () => {
    expect(isPortalUrl({ search: "" })).toBe(false);
    expect(isPortalUrl({ search: "?lead=K7QM2P" })).toBe(false);
  });
});
