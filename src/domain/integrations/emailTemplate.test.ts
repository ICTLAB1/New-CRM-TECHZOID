import { describe, expect, it } from "vitest";
import { buildEmailHtml, buildEmailText, escapeHtml, signatureHtml } from "./emailTemplate";

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
