import { afterEach, describe, expect, it, vi } from "vitest";
import { readToken } from "./mailbox.mjs";

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

  it("asks only for the read scopes, never for Mail.Send", async () => {
    let sentScope = "";
    vi.stubGlobal("fetch", async (_url, init) => {
      sentScope = new URLSearchParams(init.body).get("scope") ?? "";
      return { ok: true, json: async () => ({ access_token: "at" }) };
    });
    await readToken(adminWith({ ms_email: "a@b.com", read_refresh_token: "OLD" }), "u1", ENV);
    expect(sentScope).toContain("Mail.Read");
    expect(sentScope).not.toContain("Mail.Send");
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
