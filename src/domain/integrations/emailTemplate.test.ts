import { describe, expect, it } from "vitest";
import { buildEmailHtml, buildEmailText, escapeHtml, signatureHtml , type EmailQuotation } from "./emailTemplate";

/**
 * What a customer receives is the one thing in this product that cannot be
 * taken back, so the markup is asserted rather than eyeballed.
 */

const SENDER = {
  name: "Abhinav Jain",
  designation: "Managing Director",
  email: "abhinav.jain@techzoidtechnologies.com",
  phone: "+91 97114 92098",
};

const COMPANY = {
  name: "TechZoid Technologies Private Limited",
  website: "www.techzoidtechnologies.com",
  addressLines: ["407 Pearl Business Park", "New Delhi, Delhi 110034", "India"],
  gstin: "07AAGCT9158R1Z0",
  cin: "U72900DL2016PTC302635",
};

const content = (over = {}) => ({
  body: "Dear Mr Sharma,\n\nPlease find attached our quotation.\n\nBest regards,",
  sender: SENDER,
  company: COMPANY,
  attachmentName: "TZ-QT-2026-27-0042 - Quotation.pdf",
  ...over,
});

describe("escaping", () => {
  it("escapes the characters that would break the markup", () => {
    expect(escapeHtml(`Smith & Sons <"Ltd">`)).toBe("Smith &amp; Sons &lt;&quot;Ltd&quot;&gt;");
  });

  it("never lets typed content become markup", () => {
    // The message body is a free-text field a person types into. It reaches
    // a customer's mail client, so it must arrive as text, not as tags.
    const html = buildEmailHtml(content({ body: "<script>alert(1)</script>" }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a company name with an ampersand wherever it appears", () => {
    const html = buildEmailHtml(content({ company: { ...COMPANY, name: "Smith & Sons" } }));
    expect(html).toContain("Smith &amp; Sons");
    expect(html).not.toMatch(/Smith & Sons/);
  });

  it("treats null and undefined as empty rather than printing them", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});

describe("the message body", () => {
  it("turns blank-line-separated text into paragraphs", () => {
    // attachmentName is dropped so only body paragraphs are counted — the
    // attachment note is a paragraph too.
    const html = buildEmailHtml(content({ body: "One.\n\nTwo.", attachmentName: null }));
    expect(html).toContain("One.");
    expect(html).toContain("Two.");
    expect((html.match(/<p style="margin:0 0 14px[^"]*font-size:14px/g) ?? []).length).toBe(2);
  });

  it("keeps a single newline as a line break rather than joining the lines", () => {
    expect(buildEmailHtml(content({ body: "Line one\nLine two" }))).toContain("Line one<br />Line two");
  });

  it("names the attachment so the customer knows what came with it", () => {
    expect(buildEmailHtml(content())).toContain("TZ-QT-2026-27-0042 - Quotation.pdf");
  });

  it("says nothing about an attachment when there isn't one", () => {
    expect(buildEmailHtml(content({ attachmentName: null }))).not.toContain("Attached:");
  });
});

describe("the signature", () => {
  it("carries the sender's own name, role and contact details", () => {
    const html = signatureHtml(SENDER, COMPANY);
    expect(html).toContain("Abhinav Jain");
    expect(html).toContain("Managing Director");
    expect(html).toContain("abhinav.jain@techzoidtechnologies.com");
    expect(html).toContain("+91 97114 92098");
  });

  it("links the email and phone so they are tappable on a phone", () => {
    const html = signatureHtml(SENDER, COMPANY);
    expect(html).toContain('href="mailto:abhinav.jain@techzoidtechnologies.com"');
    expect(html).toContain('href="tel:+919711492098"');
  });

  it("adds https to a website typed without it, but shows it without", () => {
    const html = signatureHtml(SENDER, COMPANY);
    expect(html).toContain('href="https://www.techzoidtechnologies.com"');
    expect(html).toContain(">www.techzoidtechnologies.com<");
  });

  it("leaves a website that already has a scheme alone", () => {
    const html = signatureHtml(SENDER, { ...COMPANY, website: "https://techzoid.com" });
    expect(html).toContain('href="https://techzoid.com"');
    expect(html).not.toContain("https://https://");
  });

  it("renders nothing at all rather than an empty signature block", () => {
    // "Best regards," over a blank rule reads as the sender's mistake.
    expect(signatureHtml({}, {})).toBe("");
  });

  it("includes the logo only when one is configured", () => {
    expect(signatureHtml(SENDER, COMPANY)).not.toContain("<img");
    expect(signatureHtml(SENDER, { ...COMPANY, logo: "data:image/png;base64,AAA" })).toContain("<img");
  });
});

describe("email-client compatibility", () => {
  it("lays out with tables and inline styles, which Outlook renders", () => {
    const html = buildEmailHtml(content());
    expect(html).toContain("<table");
    expect(html).toContain('role="presentation"');
  });

  it("uses no stylesheet block and no layout properties Gmail strips", () => {
    const html = buildEmailHtml(content());
    expect(html).not.toContain("<style");
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("display:grid");
    expect(html).not.toContain("position:absolute");
  });

  it("loads nothing from outside the message", () => {
    // A remote image is blocked by default in most clients and leaks when it
    // isn't. Everything is inline or a data URI.
    const html = buildEmailHtml(content({ company: { ...COMPANY, logo: "data:image/png;base64,AAA" } }));
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toContain("<link");
  });
});

describe("the plain-text version", () => {
  it("says the same things as the HTML one", () => {
    const text = buildEmailText(content());
    expect(text).toContain("Please find attached our quotation.");
    expect(text).toContain("Abhinav Jain");
    expect(text).toContain("Managing Director");
    expect(text).toContain("abhinav.jain@techzoidtechnologies.com");
    expect(text).toContain("TZ-QT-2026-27-0042 - Quotation.pdf");
  });

  it("carries no markup", () => {
    expect(buildEmailText(content())).not.toMatch(/<[a-z]/i);
  });

  it("survives a sender and company with nothing filled in", () => {
    const text = buildEmailText({ body: "Hello.", sender: {}, company: {} });
    expect(text).toContain("Hello.");
    expect(text).not.toContain("undefined");
  });
});

describe("a half-configured company", () => {
  it("renders without printing undefined anywhere", () => {
    const html = buildEmailHtml({ body: "Hello.", sender: {}, company: {} });
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("null");
  });
});

/* ── the quotation email ───────────────────────────────────────────── */

const QUOTE: EmailQuotation = {
  label: "Quotation",
  number: "TZ/QT/2026-27/0117",
  date: "24 Aug 2026",
  validLabel: "Valid until",
  validUntil: "16 Sept 2026",
  items: [{ desc: "HP EliteBook 840 G11", qty: "10 Nos.", rate: "Rs. 1,12,500.00", total: "Rs. 10,35,000.00" }],
  moneyRows: [["Taxable value", "Rs. 19,99,462.50"], ["CGST", "Rs. 1,79,951.63"], ["SGST", "Rs. 1,79,951.63"]],
  grand: "Rs. 23,59,365.75",
  grandWords: "Twenty Three Lakh Fifty Nine Thousand Rupees Only",
  isOffer: true,
  confirmTo: "sales@techzoidtechnologies.com",
};

const withQuote = (over: Partial<EmailQuotation> = {}) => ({
  body: "Dear Rajesh Kumar,\n\nPlease find attached.",
  sender: { name: "Priyanshi Sharma", designation: "Sales Manager", email: "p@techzoid.com" },
  company: { name: "TechZoid Technologies Private Limited", gstin: "07AAGCT9158R1Z0", pan: "AAGCT9158R", cin: "U72900DL2016PTC302635" },
  quotation: { ...QUOTE, ...over },
  attachmentName: "Quotation-TZ-QT-2026-27-0117.pdf",
});

describe("the header band", () => {
  it("carries the company name and strapline as TEXT", () => {
    // A header that is only a logo arrives as an empty box wherever images
    // are blocked, which is most inboxes by default.
    const html = buildEmailHtml(withQuote());
    expect(html).toContain("TechZoid Technologies Private Limited");
    expect(html).toContain("Connect, Communicate &amp; Collaborate");
  });

  it("ships no images at all, so nothing can fail to load", () => {
    expect(buildEmailHtml(withQuote())).not.toContain("<img");
  });
});

describe("what the email must never invent", () => {
  const html = buildEmailHtml(withQuote()).toLowerCase();
  const text = buildEmailText(withQuote()).toLowerCase();

  it.each([
    ["act now", "manufactured urgency"],
    ["hurry", "manufactured urgency"],
    ["expires soon", "manufactured urgency"],
    ["limited time", "manufactured urgency"],
    ["within 24 hours", "a response-time promise"],
    ["delivery in", "a delivery estimate"],
    ["award", "an unearned claim"],
    ["unsubscribe", "an unsubscribe link on transactional mail"],
  ])("says nothing like %s — %s", (phrase) => {
    expect(html).not.toContain(phrase);
    expect(text).not.toContain(phrase);
  });

  it("states the validity date as a plain fact", () => {
    expect(buildEmailHtml(withQuote())).toContain("16 Sept 2026");
    expect(buildEmailHtml(withQuote())).toContain("Valid until");
  });
});

describe("what it must say", () => {
  it("says a quotation is not an invoice, near the total", () => {
    const html = buildEmailHtml(withQuote());
    expect(html).toContain("not an invoice");
    expect(html.indexOf("not an invoice")).toBeGreaterThan(html.indexOf("Rs. 23,59,365.75"));
  });

  it("does NOT say that on a tax invoice, where it would be a lie", () => {
    const html = buildEmailHtml(withQuote({ label: "Tax invoice", isOffer: false }));
    expect(html).not.toContain("not an invoice");
  });

  it("splits the tax rather than showing one inclusive figure", () => {
    const html = buildEmailHtml(withQuote());
    expect(html).toContain("CGST");
    expect(html).toContain("SGST");
  });

  it("puts the amount in words beside the total", () => {
    expect(buildEmailHtml(withQuote())).toContain("Twenty Three Lakh");
  });

  it("carries every line item's four facts", () => {
    const html = buildEmailHtml(withQuote());
    for (const fact of ["HP EliteBook 840 G11", "10 Nos.", "Rs. 1,12,500.00", "Rs. 10,35,000.00"]) {
      expect(html, fact).toContain(fact);
    }
  });

  it("numbers the next steps in text, not by colour alone", () => {
    const html = buildEmailHtml(withQuote());
    expect(html).toContain("1.");
    expect(html).toContain("2.");
    expect(html).toContain("3.");
  });

  it("prints every registration the company has configured", () => {
    const html = buildEmailHtml(withQuote());
    expect(html).toContain("07AAGCT9158R1Z0");
    expect(html).toContain("AAGCT9158R");
    expect(html).toContain("U72900DL2016PTC302635");
  });
});

describe("email client constraints", () => {
  const html = buildEmailHtml(withQuote());

  it("uses no <style> block — Gmail and Outlook strip them", () => {
    expect(html).not.toMatch(/<style[\s>]/i);
  });

  it("uses no flexbox, grid or positioning", () => {
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("display:grid");
    expect(html).not.toContain("position:absolute");
  });

  it("holds a fixed 600px column that still collapses on a phone", () => {
    expect(html).toContain("max-width:600px");
    expect(html).toContain("width:100%");
  });

  it("never drops below 12px anywhere", () => {
    const sizes = [...html.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(5);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  it("colours every link explicitly, because clients recolour bare ones", () => {
    for (const anchor of html.match(/<a [^>]*>/g) ?? []) {
      expect(anchor, anchor).toContain("color:");
    }
  });
});

describe("the plain-text alternative", () => {
  const text = buildEmailText(withQuote());

  it("is a real alternative carrying every fact, not a stripped copy", () => {
    for (const fact of [
      "TZ/QT/2026-27/0117", "24 Aug 2026", "16 Sept 2026", "Rs. 23,59,365.75",
      "Twenty Three Lakh", "HP EliteBook 840 G11", "Rs. 1,12,500.00",
      "CGST", "SGST", "WHAT HAPPENS NEXT", "sales@techzoidtechnologies.com",
      "Quotation-TZ-QT-2026-27-0117.pdf",
    ]) {
      expect(text, fact).toContain(fact);
    }
  });

  it("carries no markup", () => {
    expect(text).not.toContain("<");
  });
});

describe("the greeting", () => {
  it("never falls back to an impersonal salutation", () => {
    // "Dear Customer" announces that the sender did not know who they were
    // writing to. The call site omits the line entirely instead.
    const html = buildEmailHtml({ ...withQuote(), body: "Please find attached." });
    expect(html).not.toContain("Dear Customer");
    expect(html).not.toContain("Sir/Madam");
    expect(html).not.toContain("Hi there");
  });
});
