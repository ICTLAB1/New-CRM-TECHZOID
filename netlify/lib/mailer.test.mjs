import { describe, expect, it } from "vitest";
import { sendMail } from "./mailer.mjs";

/**
 * A stand-in for the admin client, answering only the two table reads
 * `sendMail` makes. `rows` maps a table name to what `maybeSingle()` finds.
 */
function adminWith(rows) {
  return {
    from: (table) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: rows[table] ?? null }) }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
}

const base = { to: "customer@example.com", subject: "Payment due", message: "Please pay." };

describe("sendMail and the mailbox it was told to use", () => {
  it("refuses rather than sending a reminder from the wrong person", async () => {
    /* The whole point of "all reminders come from accounts@". If that mailbox
       is gone, falling back to the bill owner's would put a wrong From on mail
       already in a customer's inbox — unsendable once it has left. */
    const result = await sendMail({
      admin: adminWith({ ms_mail_accounts: { refresh_token: "owner-token", ms_email: "chandan.s@techzoidtechnologies.com" } }),
      accountId: "a-mailbox-that-was-deleted",
      userId: "the-bill-owner",
      ...base,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not connected any more/i);
  });

  it("does not fall back even when the named mailbox exists but never finished connecting", async () => {
    const result = await sendMail({
      admin: adminWith({
        email_accounts: { id: "acc-1", email: "accounts@techzoidtechnologies.com", refresh_token: null },
        ms_mail_accounts: { refresh_token: "owner-token", ms_email: "chandan.s@techzoidtechnologies.com" },
      }),
      accountId: "acc-1",
      userId: "the-bill-owner",
      ...base,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not connected any more/i);
  });

  it("still uses the sender's own mailbox when no mailbox was named", async () => {
    /* The interactive path, unchanged: no accountId means the old behaviour,
       and with no Microsoft credentials configured it reaches Resend. */
    const result = await sendMail({
      admin: adminWith({}),
      userId: "somebody",
      ...base,
    });
    /* Not asserting success — there is no Resend key in a test run. Asserting
       it got PAST the named-mailbox guard and tried to send at all. */
    expect(result.error ?? "").not.toMatch(/not connected any more/i);
  });
});
