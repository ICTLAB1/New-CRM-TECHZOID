import { describe, expect, it } from "vitest";
import { buildEmailHtml, buildEmailText, escapeHtml, type EmailContent } from "./emailTemplate";
import { emailProductGroups, productSentences, VENDOR_LOGO_PATHS } from "./productLines";
import { CERTIFICATION_NAMES, COMPANY_LOGO_PATH, emailCompanyFrom } from "./emailIdentity";
import { PROFILE_BODY, PROFILE_HERO, profileCallToAction } from "../outreach/profileMail";

const ORIGIN = "https://crm.example.com";

const content = (over: Partial<EmailContent> = {}): EmailContent => ({
  body: "Dear Sunita,\n\nThe profile is attached.",
  sender: { name: "Abhinav Jain", email: "a@t.com", phone: "+91 98100 00000" },
  company: { name: "TechZoid Technologies Private Limited" },
  ...over,
});

const htmlWithProducts = (origin = ORIGIN): string =>
  buildEmailHtml(content({ products: emailProductGroups(origin) }));

describe("the vendor artwork", () => {
  /**
   * THE GUARD THE SIGNATURE STRIP TAUGHT US.
   *
   * That strip named /brand/email-signature.png for weeks while nothing was
   * at that address, and every customer email carried a broken-image icon.
   * The rule since then is that code may not name a file nobody has put in
   * public/ — and now there are three more files it could get wrong.
   */
  it("NEVER NAMES A FILE THAT IS NOT THERE", async () => {
    const { existsSync } = await import("node:fs");
    expect(VENDOR_LOGO_PATHS.length).toBeGreaterThan(0);
    for (const path of VENDOR_LOGO_PATHS) {
      const onDisk = `public${path}`;
      expect(existsSync(onDisk), `${onDisk} must exist, or no email can show it`).toBe(true);
    }
  });

  it("is dropped, not written as a bare path, when there is no origin", () => {
    /* A src of "/brand/vendor-adobe.png" in an inbox resolves against
       nothing and renders as a broken image. No origin, no <img>. */
    const groups = emailProductGroups("");
    expect(groups.every((g) => g.logo === null)).toBe(true);
    const html = buildEmailHtml(content({ products: groups }));
    expect(html).not.toContain("<img");
    /* And the words are still all there, which is what the block is for. */
    expect(html).toContain("Microsoft 365 &amp; perpetual licensing");
    expect(html).toContain("AutoCAD &amp; AutoCAD LT");
    /* The colour rule is not an image either, so it survives too. */
    expect(html).toContain("border-left:4px solid #0067B8");
  });
});

describe("what we supply, as a reader sees it", () => {
  it("carries EVERY product on the list, not a sample of them", () => {
    /* The list is a claim a customer will hold us to, so the test is over
       the whole of it rather than a few names: a line silently dropped
       while editing the block is a product we have stopped offering
       without anybody deciding to. */
    const html = htmlWithProducts();
    const groups = emailProductGroups(ORIGIN);
    expect(groups).toHaveLength(3);
    for (const g of groups) {
      expect(html).toContain(escapeHtml(g.heading));
      expect(html).toContain(escapeHtml(g.detail));
      expect(g.bullets?.length, `${g.name} must list its products`).toBeGreaterThan(3);
      for (const b of g.bullets ?? []) {
        expect(html, `"${b}" must be in the email`).toContain(escapeHtml(b));
      }
    }
  });

  it("prints the commercial note where there is one", () => {
    expect(htmlWithProducts()).toContain("one-time perpetual licence");
  });

  it("rules each panel in the vendor's own colour, which is not an image", () => {
    const html = htmlWithProducts();
    for (const colour of ["#0067B8", "#0696D7", "#EB1000"]) {
      expect(html).toContain(`border-left:4px solid ${colour}`);
    }
  });

  it("says the same in the plain-text part — every product, not a summary", () => {
    const text = buildEmailText(content({ products: emailProductGroups(ORIGIN) }));
    expect(text).toContain("WHAT WE SUPPLY");
    for (const g of emailProductGroups(ORIGIN)) {
      for (const b of g.bullets ?? []) expect(text, `"${b}" must be in the text part`).toContain(b);
    }
  });

  it("points each logo at this site over https", () => {
    const html = htmlWithProducts();
    for (const path of VENDOR_LOGO_PATHS) {
      expect(html).toContain(`${ORIGIN}${path}`);
    }
  });

  /**
   * WHAT OUTLOOK SHOWS, which is the ordinary case: remote pictures are
   * refused until the reader asks for them, and in a great many company
   * mailboxes nobody ever does.
   */
  it("labels each logo with the vendor's name, so a blocked image still reads", () => {
    const html = htmlWithProducts();
    for (const vendor of ["Microsoft", "Autodesk", "Adobe"]) {
      expect(html).toContain(`alt="${vendor}"`);
    }
  });

  it("gives the logo a width and never a height", () => {
    /* A height attribute makes a BLOCKED image reserve its whole box, so
       the reader gets a word of alt text floating in an empty rectangle.
       Without it the cell collapses to its text. The festival banner
       learned this the hard way; this block is not repeating it. */
    const imgs = htmlWithProducts().match(/<img[^>]*vendor-[^>]*>/g) ?? [];
    expect(imgs.length).toBe(VENDOR_LOGO_PATHS.length);
    for (const img of imgs) {
      expect(img).toMatch(/\swidth="\d+"/);
      expect(img, "a height attribute leaves a hole when the image is blocked").not.toMatch(/\sheight="/);
    }
  });
});

describe("the band across the top, and the ask under the products", () => {
  const draft = () => ({
    hero: PROFILE_HERO,
    callToAction: profileCallToAction("abhinav@techzoidtechnologies.com"),
  });

  it("sets the headline as text on a colour, never as a picture of text", () => {
    const { hero } = draft();
    const html = buildEmailHtml(content({ hero }));
    expect(html).toContain(escapeHtml(hero.headline));
    expect(html).toContain(escapeHtml(hero.eyebrow));
    /* No <img> came with it: a headline a reader cannot select, search or
       have read aloud is a headline most of them never see at all. */
    expect(html.match(/<img/g) ?? []).toHaveLength(0);
  });

  it("gives the button a real destination, and the same ask in words", () => {
    const { callToAction } = draft();
    const html = buildEmailHtml(content({ callToAction }));
    expect(html).toContain("mailto:abhinav@techzoidtechnologies.com");
    expect(html).toContain(escapeHtml(callToAction.label));
    for (const line of callToAction.lines) expect(html).toContain(escapeHtml(line));
  });

  it("DRAWS NO BUTTON when there is no address to reply to", () => {
    /* A button that goes nowhere is worse than no button. */
    const cta = profileCallToAction("");
    expect(cta.href).toBe("");
    const html = buildEmailHtml(content({ callToAction: cta }));
    /* The label is the button; with nowhere to go it is not drawn at all.
       (Asserting on "<a href" would be wrong — the footer has the company's
       own mailto and website links, and those are not this.) */
    expect(html).not.toContain(cta.label);
    /* The ask itself still reads — it is the button that is missing, not
       the sentence that explains what to send. */
    expect(html).toContain(escapeHtml(cta.heading));
  });

  it("refuses a destination that is not a mail or web address", () => {
    const html = buildEmailHtml(content({
      callToAction: { heading: "h", lines: [], label: "Go", href: "javascript:alert(1)" },
    }));
    expect(html).not.toContain("javascript:");
  });

  it("puts the link in full in the plain-text part, where there is no button", () => {
    const { callToAction } = draft();
    const text = buildEmailText(content({ callToAction }));
    expect(text).toContain("mailto:abhinav@techzoidtechnologies.com");
    expect(text).toContain(callToAction.heading.toUpperCase());
  });

  it("keeps the ask out of the body, so it is not written twice", () => {
    expect(PROFILE_BODY).not.toMatch(/reply to this email/i);
  });
});

describe("the ISO certification marks", () => {

  const company = (origin = ORIGIN) =>
    emailCompanyFrom({ company: { name: "TechZoid" } }, { origin });

  it("states them as ONE SENTENCE in the signature, not as badge images", () => {
    /* They were three badge images. The marks were genuine and rendered
       correctly, but never looked like part of the signature — and a
       certification is a claim, which reads better stated than drawn. */
    const html = buildEmailHtml(content({ company: company() }));
    expect(html).toContain(
      "An ISO 9001:2015, ISO 27001 and ISO/IEC 20000-1:2018 certified company",
    );
    expect(html).not.toContain("iso-9001");
    expect(html).not.toContain("<img src=\"https://crm.example.com/brand/iso");
  });

  it("says it once in the message, not again in the footer", () => {
    const html = buildEmailHtml(content({ company: company() }));
    expect((html.match(/certified company/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain("Certified to ISO");
  });



  it("says the names in words as well, so pictures-off loses nothing", () => {
    const html = buildEmailHtml(content({ company: company() }));
    const text = buildEmailText(content({ company: company() }));
    for (const name of CERTIFICATION_NAMES) {
      expect(html, `${name} must be written out, not only drawn`).toContain(escapeHtml(name));
      expect(text, `${name} must be in the plain-text part`).toContain(name);
    }
  });




  it("claims no version number the artwork does not itself carry", () => {
    /* A certification is the one line on an email a compliance team may go
       and verify. The badge supplied says "ISO 27001" with no year, so
       neither does this. */
    expect(CERTIFICATION_NAMES).toContain("ISO 27001");
    expect(CERTIFICATION_NAMES.join(" ")).not.toContain("27001:");
  });

  it("reads as sentences, not as one welded-together line", () => {
    /* It ran "We are certified to A, B, C, and the profile carries the
       registration details your purchase team usually asks for. The lines
       we supply are listed below." — three ideas in one line, ending in a
       signpost. A covering note gets read once. */
    const paras = PROFILE_BODY.split("\n\n").filter((p) => p.trim());
    /* The wording is the company's own now, so this no longer dictates how
       many paragraphs there are. What it still holds is the shape: one
       idea per paragraph, nothing welded. */
    for (const p of paras) {
      const sentences = p.split(/(?<=\.)\s+/).filter(Boolean);
      expect(sentences.length, p).toBeLessThanOrEqual(2);
      for (const sentence of sentences) {
        expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(40);
      }
    }
  });

  it("names them in the body too, from the same one list", () => {
    for (const name of CERTIFICATION_NAMES) expect(PROFILE_BODY).toContain(name);
    /* Named, not alluded to: the reader should not have to open the
       attachment to find out which certifications we hold. */
    expect(PROFILE_BODY).not.toMatch(/the certifications .* usually asks for/i);
  });
});

describe("every other email is unchanged", () => {
  it("prints nothing at all when there are no products", () => {
    for (const products of [undefined, null, []]) {
      const html = buildEmailHtml(content({ products }));
      expect(html).not.toContain("What we supply");
      /* And no band and no button either, on every email but this one. */
      expect(html).not.toContain(PROFILE_HERO.headline);
      expect(html).not.toContain("vendor-microsoft");
      expect(buildEmailText(content({ products }))).not.toContain("WHAT WE SUPPLY");
    }
  });
});

describe("the company's own wordmark, at the top of the message", () => {
  it("NEVER NAMES A FILE THAT IS NOT THERE", async () => {
    if (!COMPANY_LOGO_PATH) return;
    const { existsSync } = await import("node:fs");
    const onDisk = `public${COMPANY_LOGO_PATH}`;
    expect(existsSync(onDisk), `${onDisk} must exist, or no email can show it`).toBe(true);
  });

  /**
   * THE BUG THIS FIXES. `settings.company.logo` holds the logo as a data:
   * URI — right for the PDF, which embeds its images, and a broken picture
   * in an inbox, because Gmail strips data: sources outright. Handing it to
   * an <img src> is why the uploaded logo has never once appeared on an
   * email.
   */
  it("never puts the uploaded data: URI in an email", () => {
    const company = emailCompanyFrom(
      { company: { name: "TechZoid", logo: "data:image/png;base64,AAAA" } },
      { origin: ORIGIN },
    );
    expect(company.logo ?? "").not.toContain("data:");
    expect(company.logo).toBe(`${ORIGIN}${COMPANY_LOGO_PATH}`);
    expect(buildEmailHtml(content({ company }))).not.toContain("data:image");
  });

  it("honours an https address somebody entered, over the hosted file", () => {
    const own = "https://www.techzoidtechnologies.com/logo.png";
    const company = emailCompanyFrom({ company: { name: "TechZoid", logo: own } }, { origin: ORIGIN });
    expect(company.logo).toBe(own);
  });

  it("shows no logo at all rather than a path no mail client can resolve", () => {
    const company = emailCompanyFrom({ company: { name: "TechZoid" } }, { origin: "" });
    expect(company.logo).toBeUndefined();
    const html = buildEmailHtml(content({ company }));
    expect(html).not.toContain("company-logo.png");
    /* The name and the strapline carry the masthead on their own. */
    expect(html).toContain("TechZoid");
  });

  it("prints it ABOVE the name, which is what renders when pictures are off", () => {
    const company = emailCompanyFrom(
      { company: { name: "TechZoid Technologies Private Limited" } },
      { origin: ORIGIN },
    );
    const html = buildEmailHtml(content({ company }));
    expect(html).toContain(`${ORIGIN}${COMPANY_LOGO_PATH}`);
    expect(html).toContain("TechZoid Technologies Private Limited");
    expect(html.indexOf("company-logo.png"))
      .toBeLessThan(html.indexOf("TechZoid Technologies Private Limited</div>"));
    /* EMPTY ALT, on purpose. The name is in bold right underneath, so an
       alt carrying it printed the company's name twice to every reader with
       pictures off — the second time wrapped over three lines inside the
       logo's own narrow box. Decorative image, silent fallback. Found by
       rendering the thing and looking at it. */
    expect(html).toContain('alt=""');
    expect(html).not.toContain('alt="TechZoid Technologies Private Limited"');
    /* And no height attribute — a blocked image must collapse, not leave a
       hole. Same rule as the vendor marks and the festival banner. */
    const img = (html.match(/<img[^>]*company-logo[^>]*>/) ?? [""])[0];
    expect(img).toMatch(/\swidth="\d+"/);
    expect(img).not.toMatch(/\sheight="/);
  });

  it("appears once in the message, not again in the signature", () => {
    const company = emailCompanyFrom({ company: { name: "TechZoid" } }, { origin: ORIGIN });
    const html = buildEmailHtml(content({ company }));
    expect((html.match(/company-logo\.png/g) ?? []).length).toBe(1);
  });
});

describe("the profile email's own wording", () => {
  it("no longer recites the vendors the block beneath it lists", () => {
    /* It used to read "Microsoft, Adobe and Autodesk licensing, renewals
       and deployment" one paragraph above a block saying the same three
       names — a preamble to the thing directly below it, and two copies to
       keep in step the first time a vendor is added. */
    expect(PROFILE_BODY).not.toMatch(/Microsoft, Adobe and Autodesk/);
    /* And it does not announce the block either: "The lines we supply are
       listed below" pointed at something that already has WHAT WE SUPPLY
       written over it in capitals. */
    expect(PROFILE_BODY).not.toMatch(/listed below|are below/i);
  });

  it("offers the same three lines as sentences, for anywhere that is not an email", () => {
    const lines = productSentences();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Microsoft 365 & perpetual licensing: /);
    expect(lines.join(" ")).toContain("Architecture, Engineering & Construction Collection");
  });
});
