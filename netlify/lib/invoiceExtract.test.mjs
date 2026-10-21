import { describe, expect, it } from "vitest";
import { cleanExtraction, cleanDate, cleanAmount, systemPrompt, EXTRACT_TOOL, readerFailure} from "./invoiceExtract.mjs";

describe("cleaning what the invoice reader returns", () => {
  it("keeps good values", () => {
    const f = cleanExtraction({
      is_invoice: true, invoice_no: " TZ/26-27/0151 ", invoice_date: "2026-10-05", customer_name: "Arcadia Design Studio",
      customer_gstin: "07aabca1234f1z5", email: "priya@arcadia.in", phone: "+91 98111 22334", amount: 141600, currency: "inr", credit_days: 45,
    });
    expect(f).toMatchObject({ invoiceNo: "TZ/26-27/0151", invoiceDate: "2026-10-05", customerGstin: "07AABCA1234F1Z5", amount: 141600, currency: "INR", creditDays: 45 });
  });
  it("works out credit days from a printed due date", () => {
    expect(cleanExtraction({ invoice_date: "2026-10-01", due_date: "2026-11-15" }).creditDays).toBe(45);
  });
  it("drops nonsense instead of guessing", () => {
    const f = cleanExtraction({ invoice_date: "2026-02-31", amount: -5, email: "not an email", currency: "rupees", credit_days: 9999 });
    expect(f.invoiceDate).toBe("");
    expect(f.amount).toBe(0);
    expect(f.email).toBe("");
    expect(f.currency).toBe("INR");
    expect(f.creditDays).toBeNull();
  });
  it("reads Indian-format amounts given as text", () => {
    expect(cleanAmount("1,18,000.00")).toBe(118000);
    expect(cleanDate("05/10/2026")).toBe("");
  });
  it("flags a non-invoice", () => {
    expect(cleanExtraction({ is_invoice: false }).isInvoice).toBe(false);
  });
  it("tells the reader who the seller is so it is never taken as the customer", () => {
    expect(systemPrompt(["TechZoid Technologies"])).toContain("Never record the seller as the customer");
    expect(EXTRACT_TOOL.input_schema.required).toEqual(["is_invoice"]);
  });
  it("does not tell anyone to retry a key the API rejected", () => {
    /* The bug this is here for: a placeholder ANTHROPIC_API_KEY made Anthropic
       answer 401, and the upload box said the reader was busy — so the only
       advice on screen was to do the one thing that could never work. */
    const rejected = readerFailure(401);
    expect(rejected.message).toContain("ANTHROPIC_API_KEY");
    expect(rejected.message).not.toMatch(/busy|try again in a moment/i);
    expect(readerFailure(403).message).toBe(rejected.message);
  });
  it("names the model setting when the model is unknown", () => {
    expect(readerFailure(404).message).toContain("ANTHROPIC_MODEL");
    expect(readerFailure(404).message).not.toMatch(/busy/i);
  });
  it("still says busy for the faults that really do clear on their own", () => {
    for (const status of [500, 502, 503, 529]) {
      expect(readerFailure(status).message).toMatch(/busy/i);
      expect(readerFailure(status).status).toBe(502);
    }
  });
  it("keeps a rate limit a rate limit, and a bad scan a bad scan", () => {
    expect(readerFailure(429).status).toBe(429);
    expect(readerFailure(400).message).toContain("clearer photo");
  });
  it("answers a misconfiguration with 500, not a gateway error", () => {
    /* 502 reads as "the thing upstream hiccuped"; these are our own settings. */
    expect(readerFailure(401).status).toBe(500);
    expect(readerFailure(404).status).toBe(500);
  });
});
