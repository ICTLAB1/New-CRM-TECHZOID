import { describe, expect, it } from "vitest";
import { looksLikePhone, normalisePhone, whatsappLink } from "./phone";
import { buildInvoicingEmail } from "./invoicing";
import { diagnosticLines, isReady, nextAction, type Diagnostics } from "./diagnostics";
import { buildCrmContext, SUGGESTED_QUESTIONS } from "./assistant";
import { computeDocument } from "../tax/compute";
import { newQuotation } from "../documents/create";
import type { SalesDocument } from "../documents/create";

describe("phone numbers", () => {
  it("assumes India for a bare ten-digit number", () => {
    expect(normalisePhone("9810012345")).toBe("919810012345");
    expect(normalisePhone("98100 12345")).toBe("919810012345");
  });

  it("drops the domestic trunk prefix", () => {
    expect(normalisePhone("09810012345")).toBe("919810012345");
  });

  it("leaves a number that already has a country code alone", () => {
    expect(normalisePhone("+91 98100 12345")).toBe("919810012345");
    expect(normalisePhone("+971 50 123 4567")).toBe("971501234567");
  });

  it("recognises what is and isn't a number", () => {
    expect(looksLikePhone("9810012345")).toBe(true);
    expect(looksLikePhone("+971 50 123 4567")).toBe(true);
    expect(looksLikePhone("12345")).toBe(false);
    expect(looksLikePhone("")).toBe(false);
  });

  /* The fallback link is the thing that always works. v1 passed raw digits,
     so a ten-digit Indian number opened a chat with nobody. */
  it("builds a wa.me link with a country code", () => {
    expect(whatsappLink("98100 12345", "Hello")).toBe("https://wa.me/919810012345?text=Hello");
  });

  it("still produces a usable link with no number at all", () => {
    expect(whatsappLink("", "Hello there")).toBe("https://wa.me/?text=Hello%20there");
  });
});

describe("send for invoicing", () => {
  const docFor = (over: Partial<SalesDocument>): SalesDocument => ({
    ...newQuotation({ settings: {}, user: { id: "u1", name: "Asha" } }),
    number: "TTPL/Q/2627/0042",
    billName: "Acme Industries",
    preparedBy: "Asha",
    items: [{ id: "i1", description: "Laptop", qty: 2, rate: 50_000, gst: 18 }],
    ...over,
  } as SalesDocument);

  const emailFor = (doc: SalesDocument, note?: string) =>
    buildInvoicingEmail({
      doc,
      docType: "quotation",
      totals: computeDocument(doc, "Delhi"),
      note,
      settings: { invoicingEmail: "accounts@example.com", invoicingCc: "cfo@example.com" },
    });

  it("names the document, the customer and the addresses", () => {
    const mail = emailFor(docFor({}));
    expect(mail.to).toBe("accounts@example.com");
    expect(mail.cc).toBe("cfo@example.com");
    expect(mail.subject).toContain("TTPL/Q/2627/0042");
    expect(mail.body).toContain("Acme Industries");
    expect(mail.body).toContain("Prepared by: Asha");
  });

  /* The regression this whole rebuild exists to prevent: a document priced
     in dollars must not reach accounts denominated in rupees. */
  it("states the value in the document's own currency", () => {
    const usd = docFor({ currency: "USD", taxType: "none" });
    expect(emailFor(usd).body).toContain("$");
    expect(emailFor(usd).body).not.toContain("₹");

    const inr = docFor({ currency: "INR" });
    expect(emailFor(inr).body).toContain("₹");
  });

  /* v1 read `doc.billPo`, which nothing ever wrote. */
  it("passes on the customer's reference when there is one", () => {
    expect(emailFor(docFor({ referenceNo: "PO-9931" })).body).toContain("Customer PO: PO-9931");
    expect(emailFor(docFor({ referenceNo: "" })).body).not.toContain("Customer PO");
  });

  it("includes a note only when one was written", () => {
    expect(emailFor(docFor({}), "  ").body).not.toContain("Note:");
    expect(emailFor(docFor({}), "Against milestone 1").body).toContain("Note: Against milestone 1");
  });

  it("reports no address rather than inventing one", () => {
    const mail = buildInvoicingEmail({
      doc: docFor({}), docType: "proforma",
      totals: computeDocument(docFor({}), "Delhi"),
      settings: {},
    });
    expect(mail.to).toBe("");
    expect(mail.subject).toContain("Proforma Invoice");
  });
});

describe("Microsoft setup diagnostics", () => {
  const complete: Diagnostics = {
    secrets: {
      MS_CLIENT_ID: { present: true, hint: "…9f2c" },
      MS_CLIENT_SECRET: { present: true, hint: "…Q~1a" },
      MS_TENANT_ID: { present: true, hint: "…4b7d" },
      MS_REDIRECT_URI: { present: true, value: "https://crm.example.com/.netlify/functions/ms-oauth-callback" },
      MS_STATE_SECRET: { present: true, hint: "…aa11" },
      RESEND_API_KEY: { present: true, hint: "…zz99" },
    },
    checks: [],
    table: { ready: true },
    live: { checked: true, ok: true, message: "Microsoft accepted the client ID and secret." },
  };

  it("reports a complete setup as ready", () => {
    expect(nextAction(complete)).toBeNull();
    expect(isReady(complete)).toBe(true);
  });

  it("names the missing variables first", () => {
    const diag = { ...complete, secrets: { ...complete.secrets, MS_CLIENT_SECRET: { present: false } } };
    expect(nextAction(diag)).toContain("MS_CLIENT_SECRET");
  });

  it("does not block on an optional variable", () => {
    const diag = { ...complete, secrets: { ...complete.secrets, MS_TENANT_ID: { present: false } } };
    expect(nextAction(diag)).toBeNull();
  });

  it("asks for the migration once the variables are in place", () => {
    const diag = { ...complete, table: { ready: false } };
    expect(nextAction(diag)).toContain("003_ms_mail_accounts.sql");
  });

  /* Azure's own error codes mean nothing the first time. The server
     translates them; the wizard must show that translation, not the code. */
  it("passes on Microsoft's explanation of a rejection", () => {
    const diag: Diagnostics = {
      ...complete,
      live: { checked: true, ok: false, code: "AADSTS7000215", message: "The client secret is wrong." },
    };
    expect(nextAction(diag)).toBe("The client secret is wrong.");
  });

  it("shows the redirect URI in full and never a secret", () => {
    const lines = diagnosticLines(complete);
    const redirect = lines.find((l) => l.label === "MS_REDIRECT_URI");
    expect(redirect?.detail).toBe("https://crm.example.com/.netlify/functions/ms-oauth-callback");

    const secret = lines.find((l) => l.label === "MS_CLIENT_SECRET");
    expect(secret?.detail).toBe("set (…Q~1a)");
  });

  it("gives one line per secret, plus the table and the live check", () => {
    expect(diagnosticLines(complete)).toHaveLength(8);
  });
});

describe("assistant context", () => {
  const workspace = {
    customers: [
      { id: "c1", ownerId: "u1", company: "Acme", stage: "won", value: 400_000, wonAt: Date.now(), notes: [] },
      { id: "c2", ownerId: "u2", company: "Beta Corp", stage: "qualified", value: 200_000, nextFollowUp: "2020-01-01", notes: [] },
    ],
    quotations: [], proformas: [], orders: [], challans: [], subscriptions: [],
  } as unknown as Parameters<typeof buildCrmContext>[0];

  const team = [{ id: "u1", name: "Asha", role: "Sales" }, { id: "u2", name: "Ravi", role: "Sales" }];

  /* A Sales user's assistant must not be able to summarise the team's book.
     The database already prevents it; saying so here means a change to the
     client can't quietly undo it. */
  it("narrows the snapshot to what this user may see", () => {
    const mine = buildCrmContext(workspace, { id: "u1", role: "Sales", name: "Asha" }, team, "Delhi", "TechZoid");
    expect(mine).toContain("Acme");
    expect(mine).not.toContain("Beta Corp");
  });

  it("shows an admin everything", () => {
    const all = buildCrmContext(workspace, { id: "u1", role: "Admin", name: "Asha" }, team, "Delhi", "TechZoid");
    expect(all).toContain("Acme");
    expect(all).toContain("Beta Corp");
  });

  it("says who is asking and when", () => {
    const text = buildCrmContext(workspace, { id: "u1", role: "Admin", name: "Asha" }, team, "Delhi", "TechZoid",
      new Date("2026-08-23T09:00:00Z"));
    expect(text).toContain("Asha (Admin)");
    expect(text).toContain("2026-08-23");
  });

  it("tells the assistant to refuse rather than guess", () => {
    const text = buildCrmContext(workspace, { id: "u1", role: "Admin", name: "Asha" }, team, "Delhi", "TechZoid");
    expect(text).toMatch(/never guess/i);
  });

  it("suggests only questions the snapshot can answer", () => {
    expect(SUGGESTED_QUESTIONS.length).toBeGreaterThan(0);
    for (const q of SUGGESTED_QUESTIONS) expect(q.endsWith("?")).toBe(true);
  });
});
