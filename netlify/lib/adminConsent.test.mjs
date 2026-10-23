import { describe, expect, it } from "vitest";
import { consentCovers, readConsent, recordConsent } from "./adminConsentStore.mjs";
import { PURPOSES, signState, verifyState } from "./state.mjs";

/**
 * The one-time setup that could not say it was done.
 *
 * An administrator approved the CRM for the tenant, Microsoft confirmed it,
 * and the panel that sent them looked exactly as it had before — so they
 * approved again, and again. Nothing was broken except that nobody had ever
 * written the approval down.
 */

/** Enough of the Supabase client for a settings row that is read and written. */
function fakeAdmin(initial = {}) {
  const store = { data: initial };
  return {
    store,
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: () => Promise.resolve({ data: { data: store.data } }) };
            },
          };
        },
        update(patch) {
          return {
            eq() {
              store.data = patch.data;
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

const ENV = { MS_STATE_SECRET: "test-secret-for-admin-consent" };
const ASKED = ["openid", "profile", "offline_access", "User.Read", "Mail.Send"];

describe("recording a tenant-wide approval", () => {
  it("writes the grant without disturbing the rest of the settings row", async () => {
    const admin = fakeAdmin({ indiamart: { cursor: "7" }, companyName: "TechZoid" });
    await recordConsent(admin, { scopes: ASKED, byUserId: "u1" });

    expect(admin.store.data.indiamart).toEqual({ cursor: "7" });
    expect(admin.store.data.companyName).toBe("TechZoid");

    const read = await readConsent(admin);
    expect(read?.byUserId).toBe("u1");
    expect(read?.scopes).toEqual([...ASKED].sort());
    expect(Date.parse(read?.grantedAt ?? "")).toBeTruthy();
  });

  it("reads as nothing recorded when nobody has approved", async () => {
    expect(await readConsent(fakeAdmin({}))).toBeNull();
    /* A half-written row is not an approval either. */
    expect(await readConsent(fakeAdmin({ msAdminConsent: { scopes: ASKED } }))).toBeNull();
  });
});

describe("does the recorded grant still cover what is asked for", () => {
  it("covers an identical set, whatever the order or spacing", () => {
    expect(consentCovers(ASKED, ASKED)).toBe(true);
    expect(consentCovers([...ASKED].reverse(), ASKED)).toBe(true);
    expect(consentCovers([" Mail.Send ", ...ASKED, "Mail.Send"], ASKED)).toBe(true);
  });

  it("covers a grant wider than what is asked for", () => {
    /* Consent is not withdrawn by requesting less, and calling that stale
       would send an admin to re-approve what they already approved. */
    expect(consentCovers([...ASKED, "Mail.ReadWrite"], ASKED)).toBe(true);
  });

  it("does not cover a permission added since the approval", () => {
    /* THE LIVE PROBLEM, not a stale note: adding a scope puts the whole
       organisation back on "Need admin approval". */
    expect(consentCovers(ASKED, [...ASKED, "Mail.ReadWrite"])).toBe(false);
  });

  it("covers nothing when nothing was recorded", () => {
    expect(consentCovers([], ASKED)).toBe(false);
  });
});

describe("only an approval this server sent somebody to do", () => {
  it("round-trips its own admin-consent state", () => {
    const state = signState("u1", ENV, Date.now(), "adminconsent");
    const check = verifyState(state, ENV);
    expect(check.ok).toBe(true);
    expect(check.purpose).toBe("adminconsent");
    expect(check.userId).toBe("u1");
  });

  it("does not let a mailbox state stand in for an administrator's", () => {
    /* A user connecting their own mailbox is not an administrator approving
       for the tenant. The callback keys off the purpose, so these must stay
       distinguishable. */
    for (const purpose of ["own", "shared", "inbox"]) {
      expect(verifyState(signState("u1", ENV, Date.now(), purpose), ENV).purpose).not.toBe("adminconsent");
    }
  });

  it("rejects a state nobody signed", () => {
    /* Without this, anyone who knew the callback URL could ask for it with
       ?admin_consent=True and have the CRM report an approval Microsoft
       never granted. */
    expect(verifyState("admin-consent-please", ENV).ok).toBe(false);
    expect(verifyState(Buffer.from("u1.1.aa.adminconsent.deadbeef").toString("base64url"), ENV).ok).toBe(false);
    expect(verifyState(undefined, ENV).ok).toBe(false);
  });

  it("keeps the purpose set closed", () => {
    expect(PURPOSES.has("adminconsent")).toBe(true);
    expect(() => signState("u1", ENV, Date.now(), "anything-else")).toThrow();
  });
});
