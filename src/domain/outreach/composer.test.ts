import { describe, expect, it } from "vitest";
import { checkReadiness, fill, fillMessage, unknownVariables, valuesFor, variablesUsed } from "./personalise";
import { escapeHtml, inline, renderEmailHtml, renderPlainText, type EmailDoc } from "./emailHtml";
import { DEFAULT_SEQUENCE, TEMPLATES, byId } from "./templates";

/* ── personalisation ──────────────────────────────────────────────── */

describe("putting a prospect's details into a template", () => {
  const values = { first_name: "Ravi", company_name: "Acme Pvt Ltd", sender_name: "Abhinav" };

  it("substitutes, and tolerates the spacing people type", () => {
    expect(fill("Hello {{first_name}} at {{ company_name }}", values).text)
      .toBe("Hello Ravi at Acme Pvt Ltd");
  });

  /* THE RULE THAT MATTERS MOST. "Hello ," in a purchase manager's inbox says
     plainly that this was a mail merge and nobody checked. The variable is
     left visible so the preview shows the hole, and the recipient is
     reported rather than sent to. */
  it("never renders a hole — it reports the gap instead", () => {
    const out = fill("Hello {{first_name}}, I see {{industry}} is busy", { first_name: "Ravi" });
    expect(out.missing).toEqual(["industry"]);
    expect(out.text).toContain("{{industry}}");
    expect(out.text).not.toBe("Hello Ravi, I see  is busy");
  });

  it("treats whitespace-only data as missing", () => {
    expect(fill("Hi {{first_name}}", { first_name: "   " }).missing).toEqual(["first_name"]);
  });

  /* A typo left as literal text is how somebody notices. Replacing it with
     an empty string would hide it and ship a sentence with a hole. */
  it("leaves a misspelled variable exactly as written, and flags it", () => {
    expect(fill("Hi {{fisrt_name}}", values).text).toBe("Hi {{fisrt_name}}");
    expect(unknownVariables("Hi {{fisrt_name}}")).toEqual(["fisrt_name"]);
  });

  it("lists what a template needs, without repeats", () => {
    expect(variablesUsed("{{first_name}} at {{company_name}}", "Regards {{first_name}}"))
      .toEqual(["first_name", "company_name"]);
  });

  it("says exactly who cannot be sent to, and why", () => {
    const r = checkReadiness(
      { subject: "Licensing for {{company_name}}", body: "Hello {{first_name}}" },
      [
        { id: "1", email: "ravi@acme.in", values: { first_name: "Ravi", company_name: "Acme" } },
        { id: "2", email: "no-name@acme.in", values: { company_name: "Acme" } },
        { id: "3", email: "no-co@x.in", values: { first_name: "Meena" } },
      ],
    );
    expect(r.ready.map((x) => x.email)).toEqual(["ravi@acme.in"]);
    expect(r.blocked).toEqual([
      { id: "2", email: "no-name@acme.in", missing: ["first_name"] },
      { id: "3", email: "no-co@x.in", missing: ["company_name"] },
    ]);
  });

  it("derives a full name from the halves", () => {
    const v = valuesFor({ firstName: "Ravi", lastName: "Menon" }, { name: "Abhinav" });
    expect(v.full_name).toBe("Ravi Menon");
  });

  it("fills subject and body together", () => {
    const out = fillMessage({ subject: "For {{company_name}}", body: "Hi {{first_name}}" }, values);
    expect(out.subject).toBe("For Acme Pvt Ltd");
    expect(out.body).toBe("Hi Ravi");
    expect(out.missing).toEqual([]);
  });
});

/* ── email-safe HTML ──────────────────────────────────────────────── */

const DOC: EmailDoc = {
  subject: "Software licensing for Acme",
  preheader: "A quick introduction",
  branding: { companyName: "TechZoid Technologies", website: "techzoid.in", addressLines: ["New Delhi, India"], accentColor: "#2563EB" },
  unsubscribeUrl: "https://crm.ttpldelhi.com/u/abc",
  blocks: [
    { kind: "paragraph", text: "Hello Ravi," },
    { kind: "paragraph", text: "We supply **Microsoft** and _Adobe_ licensing. [Our site](https://techzoid.in)" },
    { kind: "bullets", items: ["Renewals in one place", "GST invoicing"] },
    { kind: "button", label: "Reply to this email", href: "https://techzoid.in/contact" },
    { kind: "divider" },
    { kind: "signature", text: "Abhinav Jain\nTechZoid Technologies" },
  ],
};

describe("HTML that survives Outlook", () => {
  const html = renderEmailHtml(DOC);

  /* Outlook on Windows renders with Word's engine: no flexbox, no grid, no
     max-width on a div. Tables are not nostalgia, they are the only layout
     that works. */
  it("lays out with tables and a fixed width", () => {
    expect(html).toContain("<table");
    expect(html).toContain("width=\"600\"");
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/display:\s*grid/);
  });

  it("puts styles inline, because a style block is unreliable", () => {
    expect(html).toContain('style="margin:0 0 16px 0;font-family:Arial');
    expect(html).not.toContain("<style");
  });

  it("uses only fonts that exist on the machine", () => {
    expect(html).toContain("Arial, Helvetica, sans-serif");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).not.toContain("@font-face");
  });

  it("carries no script, form or external stylesheet", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("rel=\"stylesheet\"");
  });

  /* A styled <a> collapses to plain underlined text in Outlook — padding and
     background are simply dropped. The one-cell table is the only shape that
     survives, which is why every serious template looks like this. */
  it("builds a button as a table so it keeps its shape", () => {
    expect(html).toMatch(/<table[^>]*>\s*<tr><td align="center" bgcolor="#2563EB"/);
  });

  it("renders bold, italic and https links from markers", () => {
    expect(html).toContain("<strong>Microsoft</strong>");
    expect(html).toContain("<em>Adobe</em>");
    expect(html).toContain('href="https://techzoid.in"');
  });

  /* A link built from a template variable is how a composer becomes an
     attack surface. Only https is turned into a link. */
  it("refuses to build a link from anything but https", () => {
    expect(inline("[click](javascript:alert(1))")).not.toContain("<a ");
    expect(inline("[click](http://insecure.example)")).not.toContain("<a ");
    expect(inline("[click](mailto:x@y.in)")).not.toContain("<a ");
  });

  it("escapes what a prospect's own data might contain", () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    const nasty = renderEmailHtml({ ...DOC, blocks: [{ kind: "paragraph", text: "<img src=x onerror=alert(1)>" }] });
    expect(nasty).not.toContain("<img src=x");
  });

  it("includes the unsubscribe link every outreach email needs", () => {
    expect(html).toContain("https://crm.ttpldelhi.com/u/abc");
    expect(html).toContain("unsubscribe");
  });

  /* Without the padding, whatever text follows leaks into the client's
     preview line beside the subject. */
  it("hides the preheader and pads it so body text does not leak in", () => {
    expect(html).toContain("A quick introduction");
    expect(html).toMatch(/display:none;font-size:1px/);
    expect(html).toContain("&zwnj;");
  });
});

describe("the plain-text alternative", () => {
  const text = renderPlainText(DOC);

  /* Some corporate gateways strip HTML and deliver the text part. If it is
     empty the customer receives a blank email. */
  it("is a real message, not an empty part", () => {
    expect(text.length).toBeGreaterThan(80);
    expect(text).toContain("Hello Ravi,");
  });

  it("carries no markup and no leftover markers", () => {
    expect(text).not.toContain("<");
    expect(text).not.toContain("**");
    expect(text).toContain("Microsoft");
    expect(text).toContain("Adobe");
  });

  it("keeps links readable and the unsubscribe reachable", () => {
    expect(text).toContain("https://techzoid.in");
    expect(text).toContain("https://crm.ttpldelhi.com/u/abc");
  });

  it("renders lists as lists", () => {
    expect(text).toContain("- Renewals in one place");
  });
});

/* ── the library itself ───────────────────────────────────────────── */

describe("the templates", () => {
  it("has every one the brief asked for, with a sequence that fits together", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10);
    for (const id of DEFAULT_SEQUENCE) expect(byId(id), id).toBeDefined();
  });

  it("uses no variable this system cannot fill", () => {
    for (const t of TEMPLATES) {
      const texts = [t.subject, t.preheader, ...t.blocks.flatMap((b) => [b.text ?? "", ...(b.items ?? [])])];
      expect(unknownVariables(...texts), t.id).toEqual([]);
    }
  });

  /* THE GUARD. Not a style preference: this language is what makes a
     legitimate B2B email read as bulk mail, and it is what the brief
     explicitly forbade. A new template written in a hurry gets caught here. */
  it("contains none of the pressure language that makes mail look like spam", () => {
    const banned = [
      /limited time/i, /act now/i, /\burgent\b/i, /exclusive offer/i,
      /guaranteed savings/i, /can'?t miss/i, /don'?t miss/i, /last chance/i,
      /hurry/i, /risk[- ]free/i, /100% free/i, /special promotion/i,
      /dear sir\/madam/i, /!{2,}/,
    ];
    for (const t of TEMPLATES) {
      const all = [t.subject, t.preheader, ...t.blocks.flatMap((b) => [b.text ?? "", ...(b.items ?? [])])].join(" ");
      for (const rx of banned) {
        expect(rx.test(all), `${t.id} contains ${rx}`).toBe(false);
      }
    }
  });

  it("promises no number we cannot stand behind", () => {
    for (const t of TEMPLATES) {
      const all = [t.subject, ...t.blocks.flatMap((b) => [b.text ?? "", ...(b.items ?? [])])].join(" ");
      expect(/save \d+%|\d+% (?:off|savings|discount)|cheapest|lowest price/i.test(all), t.id).toBe(false);
    }
  });

  it("shouts at nobody", () => {
    for (const t of TEMPLATES) {
      expect(/\b[A-Z]{5,}\b/.test(t.subject), `${t.id} subject shouts`).toBe(false);
    }
  });

  /* THE SIGNATURE MOVED, and this now asserts the opposite of what it used
     to. A template used to end with a {{sender_signature}} block, which only
     ever carried the sender's job title. The renderer now appends the real
     one — name, logo, both offices, the partner badges, the disclaimer —
     built from the workspace's settings, so a template carrying a block of
     its own would print the job title twice: once bare, and again inside the
     block directly underneath. See src/domain/outreach/signature.ts. */
  it("leaves the signing to the renderer, so nothing is signed twice", () => {
    for (const t of TEMPLATES) {
      expect(t.blocks.some((b) => b.kind === "signature"), t.id).toBe(false);
    }
  });

  it("still ends on the sender's own words rather than trailing off", () => {
    for (const t of TEMPLATES) {
      const last = t.blocks[t.blocks.length - 1];
      expect(last?.kind, t.id).toBe("paragraph");
      expect(String(last?.text ?? "").trim().length, t.id).toBeGreaterThan(10);
    }
  });

  it("renders every template to valid email HTML and readable text", () => {
    for (const t of TEMPLATES) {
      const doc: EmailDoc = { subject: t.subject, preheader: t.preheader, blocks: t.blocks,
        branding: { companyName: "TechZoid" }, unsubscribeUrl: "https://x.in/u/1" };
      const h = renderEmailHtml(doc);
      expect(h, t.id).toContain("<table");
      expect(h, t.id).not.toContain("<script");
      expect(renderPlainText(doc).length, t.id).toBeGreaterThan(40);
    }
  });

  it("spaces the sequence so nothing arrives on consecutive days", () => {
    const waits = DEFAULT_SEQUENCE.map((id) => byId(id)!).slice(1).map((t) => t.waitDays ?? 0);
    for (const w of waits) expect(w).toBeGreaterThanOrEqual(3);
  });
});
