import { describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { AuthError, refresh, setPassword, signIn, signOut } from "./localAuth.mjs";

process.env.JWT_SECRET ||= "a-test-signing-secret-at-least-32-chars-long";

const UID = "11111111-1111-1111-1111-111111111111";
const HASH = bcrypt.hashSync("correct horse battery", 10);

/** A pg client that answers from a fixture and records what it was asked. */
function fakeClient({ user = null, tokenRow = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      if (/from auth\.users where lower\(email\)/i.test(sql)) return { rows: user ? [user] : [] };
      if (/from auth\.refresh_tokens t/i.test(sql)) return { rows: tokenRow ? [tokenRow] : [] };
      return { rows: [] };
    },
  };
}
const USER = {
  id: UID, email: "neha@techzoid.in", encrypted_password: HASH,
  raw_user_meta_data: { name: "Neha" }, created_at: new Date(), banned_until: null, deleted_at: null,
};

describe("signing in against our own database", () => {
  it("returns a session for the right password", async () => {
    const c = fakeClient({ user: USER });
    const s = await signIn(c, "neha@techzoid.in", "correct horse battery");
    expect(s.token_type).toBe("bearer");
    expect(s.user.id).toBe(UID);
    expect(s.access_token.split(".")).toHaveLength(3);
    expect(s.refresh_token).toBeTruthy();
  });

  it("matches the address regardless of case", async () => {
    const c = fakeClient({ user: USER });
    await expect(signIn(c, "NEHA@TechZoid.IN", "correct horse battery")).resolves.toBeTruthy();
  });

  it("refuses the wrong password", async () => {
    const c = fakeClient({ user: USER });
    await expect(signIn(c, "neha@techzoid.in", "hunter2")).rejects.toThrow(AuthError);
  });

  /* -- THE ONES THAT MATTER ------------------------------------------ */

  it("says the SAME thing for an unknown address as for a wrong password", async () => {
    /* Two different messages turn the sign-in form into a directory of who
       has an account, readable by anyone with a browser. */
    const wrongPassword = await signIn(fakeClient({ user: USER }), "neha@techzoid.in", "nope")
      .catch((e) => e.message);
    const noSuchUser = await signIn(fakeClient({ user: null }), "ghost@techzoid.in", "nope")
      .catch((e) => e.message);
    expect(wrongPassword).toBe(noSuchUser);
  });

  it("still does the bcrypt work for an address that does not exist", async () => {
    /* Skipping it makes an unknown address answer measurably faster, which
       is the same directory read, timed instead of displayed. */
    const t0 = Date.now();
    await signIn(fakeClient({ user: null }), "ghost@techzoid.in", "nope").catch(() => {});
    const unknown = Date.now() - t0;
    const t1 = Date.now();
    await signIn(fakeClient({ user: USER }), "neha@techzoid.in", "nope").catch(() => {});
    const known = Date.now() - t1;
    /* Not asserting they are equal -- that would be flaky. Asserting the
       unknown one is not CHEAP, which is what skipping would make it. */
    expect(unknown).toBeGreaterThan(known / 4);
  });

  it("never puts the password hash in what it returns", async () => {
    const s = await signIn(fakeClient({ user: USER }), "neha@techzoid.in", "correct horse battery");
    expect(JSON.stringify(s)).not.toContain(HASH);
    expect(JSON.stringify(s)).not.toContain("encrypted_password");
  });

  it("refuses a deleted account even with the right password", async () => {
    const c = fakeClient({ user: { ...USER, deleted_at: new Date() } });
    await expect(signIn(c, "neha@techzoid.in", "correct horse battery")).rejects.toThrow(/Invalid login/);
  });

  it("refuses a suspended account, and says so", async () => {
    const c = fakeClient({ user: { ...USER, banned_until: new Date(Date.now() + 86400e3) } });
    await expect(signIn(c, "neha@techzoid.in", "correct horse battery")).rejects.toThrow(/suspended/);
  });

  it("stores a HASH of the refresh token, never the token", async () => {
    /* A backup that leaks these would otherwise be a fortnight of silent
       access to every account in the company. */
    const c = fakeClient({ user: USER });
    const s = await signIn(c, "neha@techzoid.in", "correct horse battery");
    const insert = c.calls.find((x) => /insert into auth\.refresh_tokens/i.test(x.sql));
    expect(insert.params[1]).toEqual(createHash("sha256").update(s.refresh_token).digest());
    expect(JSON.stringify(insert.params)).not.toContain(s.refresh_token);
  });
});

describe("refreshing", () => {
  const live = {
    id: 7, expires_at: new Date(Date.now() + 86400e3), revoked_at: null,
    user_id: UID, email: "neha@techzoid.in", raw_user_meta_data: {}, created_at: new Date(),
    deleted_at: null, banned_until: null,
  };

  it("retires the token it just used", async () => {
    /* Without rotation a token copied off a shared machine keeps working
       for a fortnight beside the real one, and nothing notices. */
    const c = fakeClient({ tokenRow: live });
    await refresh(c, "some-token");
    expect(c.calls.some((x) => /update auth\.refresh_tokens set revoked_at/i.test(x.sql))).toBe(true);
  });

  it("refuses an already-revoked token", async () => {
    const c = fakeClient({ tokenRow: { ...live, revoked_at: new Date() } });
    await expect(refresh(c, "replayed")).rejects.toThrow(AuthError);
  });

  it("refuses an expired token", async () => {
    const c = fakeClient({ tokenRow: { ...live, expires_at: new Date(Date.now() - 1000) } });
    await expect(refresh(c, "stale")).rejects.toThrow(AuthError);
  });

  it("refuses a token that was never issued", async () => {
    await expect(refresh(fakeClient({ tokenRow: null }), "invented")).rejects.toThrow(AuthError);
  });
});

describe("changing a password", () => {
  it("ends every existing session", async () => {
    /* Changing a password somebody else knows achieves nothing if their
       refresh token outlives the change. */
    const c = fakeClient();
    await setPassword(c, UID, "a new long password");
    expect(c.calls.some((x) => /update auth\.refresh_tokens set revoked_at/i.test(x.sql))).toBe(true);
  });

  it("refuses a password too short to be worth having", async () => {
    await expect(setPassword(fakeClient(), UID, "short")).rejects.toThrow(AuthError);
  });

  it("stores bcrypt, not the password", async () => {
    const c = fakeClient();
    await setPassword(c, UID, "a new long password");
    const up = c.calls.find((x) => /set encrypted_password/i.test(x.sql));
    expect(up.params[1]).toMatch(/^\$2[aby]\$/);
    expect(up.params[1]).not.toContain("a new long password");
  });
});

describe("signing out", () => {
  it("does not mind being called twice", async () => {
    await expect(signOut(fakeClient(), "a-token")).resolves.toBeUndefined();
    await expect(signOut(fakeClient(), undefined)).resolves.toBeUndefined();
  });
});
