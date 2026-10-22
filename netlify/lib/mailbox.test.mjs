import { afterEach, describe, expect, it, vi } from "vitest";
import { readToken } from "./mailbox.mjs";
import { READ_SCOPES } from "./mailer.mjs";
import { INBOX_SCOPES, SCOPES } from "../functions/ms-oauth-start.mjs";

const ENV = { MS_CLIENT_ID: "cid", MS_CLIENT_SECRET: "secret", MS_TENANT_ID: "tid" };

/** Records every column written, so a test can assert what was NOT. */
function adminWith(row) {
  const writes = [];
  return {
    writes,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
      update: (patch) => { writes.push(patch); return { eq: async () => ({ error: null }) }; },
    }),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("reading a mailbox never puts sending at risk", () => {
  it("stores a rotated token in the read column and never over the send one", async () => {
    /* THE failure this guards. Microsoft rotates refresh tokens; writing the
       rotated one to `refresh_token` would replace a Mail.Send grant with a
       Mail.Read one, and this person's quotations would stop going out with
       "your connection has expired". */
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ access_token: "at", refresh_token: "ROTATED" }),
    }));
    const admin = adminWith({ ms_email: "a@b.com", read_refresh_token: "OLD" });

    const got = await readToken(admin, "u1", ENV);

    expect(got.ok).toBe(true);
    expect(admin.writes).toHaveLength(1);
    expect(admin.writes[0].read_refresh_token).toBe("ROTATED");
    expect(Object.keys(admin.writes[0])).not.toContain("refresh_token");
  });

  it("never asks a refresh for more than the consent granted", async () => {
    /* THE invariant, and the one that nearly took quotations offline once:
       a refresh may request a SUBSET of what was consented and never a
       superset (AADSTS65001). So what mailbox.mjs asks for on refresh must
       stay within what ms-oauth-start asked the person to approve. Widening
       one without the other is the bug, and it is silent until every
       connected mailbox stops refreshing. */
    let sentScope = "";
    vi.stubGlobal("fetch", async (_url, init) => {
      sentScope = new URLSearchParams(init.body).get("scope") ?? "";
      return { ok: true, json: async () => ({ access_token: "at" }) };
    });
    await readToken(adminWith({ ms_email: "a@b.com", read_refresh_token: "OLD" }), "u1", ENV);

    const consented = new Set(INBOX_SCOPES.split(/\s+/).filter(Boolean));
    const asked = sentScope.split(/\s+/).filter(Boolean);
    expect(asked.length).toBeGreaterThan(0);
    for (const scope of asked) expect([...consented]).toContain(scope);
  });

  it("is a different grant from the one quotations use", async () => {
    /* They overlap, and that is fine — they are separate consents producing
       separate tokens. What must never happen is one token covering both,
       because then losing the mailbox grant takes sending with it. */
    expect(READ_SCOPES).not.toBe(SCOPES);
    expect(READ_SCOPES).toContain("Mail.ReadWrite");
    expect(SCOPES).not.toContain("Mail.ReadWrite");
  });

  it("treats a mailbox that never turned reading on as an offer, not a fault", async () => {
    const got = await readToken(adminWith({ ms_email: "a@b.com", read_refresh_token: null }), "u1", ENV);
    expect(got.ok).toBe(false);
    expect(got.needsConsent).toBe(true);
  });

  it("asks for consent again when the read grant has been revoked", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) }));
    const got = await readToken(adminWith({ ms_email: "a@b.com", read_refresh_token: "REVOKED" }), "u1", ENV);
    expect(got.ok).toBe(false);
    expect(got.needsConsent).toBe(true);
    /* And nothing was written — a failed refresh must not clear the column
       and lose the grant that a retry might still honour. */
  });

  it("writes nothing at all when the token did not rotate", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true, json: async () => ({ access_token: "at", refresh_token: "SAME" }),
    }));
    const admin = adminWith({ ms_email: "a@b.com", read_refresh_token: "SAME" });
    await readToken(admin, "u1", ENV);
    expect(admin.writes).toEqual([]);
  });
});
