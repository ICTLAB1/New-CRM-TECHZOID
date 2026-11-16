import { describe, expect, it } from "vitest";
import {
  SIGNATURE_IMAGE_ALT, SIGNATURE_IMAGE_PATH, absoluteUrl, emailCompanyFrom,
} from "./emailIdentity";
import { signatureHtml } from "./emailTemplate";

const SETTINGS = {
  company: {
    name: "TechZoid Technologies Private Limited",
    website: "www.techzoidtechnologies.com",
    email: "sales@techzoidtechnologies.com",
    phone: "+91 97114 92098",
    phoneUae: "+971 58 939 7239",
    gstin: "07AAICT5606J1Z4",
    cin: "U72900DL2021PTC380025",
  },
};

const ORIGIN = "https://crm.ttpldelhi.com";

describe("one company block, for every email the CRM sends", () => {
  it("fills the details from the settings row", () => {
    const c = emailCompanyFrom(SETTINGS, { origin: ORIGIN });
    expect(c.name).toBe("TechZoid Technologies Private Limited");
    expect(c.website).toBe("www.techzoidtechnologies.com");
    expect(c.gstin).toBe("07AAICT5606J1Z4");
  });

  it("carries both offices, each with the country it rings", () => {
    const c = emailCompanyFrom(SETTINGS, { origin: ORIGIN });
    expect(c.phones).toEqual([
      { label: "India", number: "+91 97114 92098" },
      { label: "UAE", number: "+971 58 939 7239" },
    ]);
  });

  it("does not make a two-country list out of one number", () => {
    const one = emailCompanyFrom({ company: { phone: "+91 97114 92098" } }, { origin: ORIGIN });
    expect(one.phones).toBeUndefined();
    expect(one.phone).toBe("+91 97114 92098");
  });

  it("survives a settings row with nothing in it", () => {
    const c = emailCompanyFrom({}, { origin: ORIGIN });
    expect(c.name).toBe("");
    expect(c.phones).toBeUndefined();
  });
});

describe("the signature strip", () => {
  it("IS OFF when no artwork has been supplied", () => {
    /* The fault this exists to stop: the code named a file nobody had put
       on the site, so every email carried a broken-image icon with the alt
       text spilling out underneath it. No file, no <img>. */
    const c = emailCompanyFrom(SETTINGS, { origin: ORIGIN });
    expect(SIGNATURE_IMAGE_PATH).toBe("");
    expect(c.signatureImage).toBeNull();
  });

  it("is on, at an absolute URL, once somebody points it at a file", () => {
    const c = emailCompanyFrom(
      { company: { ...SETTINGS.company, signatureImage: "/brand/email-signature.png" } },
      { origin: ORIGIN },
    );
    expect(c.signatureImage?.src).toBe(`${ORIGIN}/brand/email-signature.png`);
  });

  it("is NEVER a data: URI", () => {
    /* Gmail strips an embedded image outright, so a signature built that
       way is simply missing for most readers — with nothing in its place. */
    const c = emailCompanyFrom(
      { company: { ...SETTINGS.company, signatureImage: "data:image/png;base64,AAAA" } },
      { origin: ORIGIN },
    );
    expect(c.signatureImage?.src).not.toMatch(/^data:/);
  });

  it("can be pointed somewhere else, or turned off, without a code change", () => {
    const elsewhere = emailCompanyFrom(
      { company: { ...SETTINGS.company, signatureImage: "https://cdn.example.com/sig.png" } },
      { origin: ORIGIN },
    );
    expect(elsewhere.signatureImage?.src).toBe("https://cdn.example.com/sig.png");

    const off = emailCompanyFrom({ company: { ...SETTINGS.company, signatureImage: "" } }, { origin: ORIGIN });
    expect(off.signatureImage).toBeNull();
  });

  it("names the strip briefly for a blocked image, rather than reciting it", () => {
    /* Outlook blocks images by default, so this is what a great many
       readers see. The first version was the whole list of partnerships
       and certifications, which read as a run-on paragraph wedged under a
       broken-image icon. */
    const c = emailCompanyFrom(
      { company: { ...SETTINGS.company, signatureImage: "/brand/email-signature.png" } },
      { origin: ORIGIN },
    );
    expect(c.signatureImage?.alt).toBe(SIGNATURE_IMAGE_ALT);
    expect(SIGNATURE_IMAGE_ALT.length).toBeLessThan(80);
  });

  it("claims nothing the artwork does not show", () => {
    /* A partnership the company was never granted is a false statement on
       every email it sends. The words here track the strip and no further. */
    expect(SIGNATURE_IMAGE_ALT).not.toMatch(/gold|elite|premier|tier|authorized distributor/i);
  });

  it("reaches the rendered signature, underneath the written one", () => {
    const html = signatureHtml(
      { name: "Abhinav Jain", email: "abhinav.jain@techzoidtechnologies.com", designation: "Managing Director" },
      emailCompanyFrom(
        { company: { ...SETTINGS.company, signatureImage: "/brand/email-signature.png" } },
        { origin: ORIGIN },
      ),
    );
    expect(html).toContain("Abhinav Jain");
    expect(html).toContain(`${ORIGIN}/brand/email-signature.png`);
    expect(html).toContain("INDIA");
    expect(html).toContain("UAE");
    expect(html.indexOf("Abhinav Jain")).toBeLessThan(html.indexOf("email-signature.png"));
  });

  it("PUTS NO <img> IN THE SIGNATURE when there is no artwork", () => {
    const html = signatureHtml(
      { name: "Abhinav Jain", email: "abhinav.jain@techzoidtechnologies.com", designation: "Managing Director" },
      emailCompanyFrom(SETTINGS, { origin: ORIGIN }),
    );
    expect(html).toContain("Abhinav Jain");
    expect(html).not.toContain("<img");
  });

  it("NEVER NAMES A FILE THAT IS NOT THERE", async () => {
    /* The guard that would have caught this before it reached a customer:
       whatever SIGNATURE_IMAGE_PATH names has to exist in public/. Empty
       is fine — that is the strip being off. */
    if (!SIGNATURE_IMAGE_PATH) return;
    const { existsSync } = await import("node:fs");
    const onDisk = `public${SIGNATURE_IMAGE_PATH}`;
    expect(existsSync(onDisk), `${onDisk} must exist, or no email can show it`).toBe(true);
  });
});

describe("absolute URLs, because a mail client has no page to be relative to", () => {
  it("puts the site in front of a path", () => {
    expect(absoluteUrl("/brand/x.png", ORIGIN)).toBe(`${ORIGIN}/brand/x.png`);
    expect(absoluteUrl("brand/x.png", ORIGIN)).toBe(`${ORIGIN}/brand/x.png`);
  });

  it("leaves one that is already absolute alone", () => {
    expect(absoluteUrl("https://cdn.example.com/x.png", ORIGIN)).toBe("https://cdn.example.com/x.png");
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(absoluteUrl("/brand/x.png", "https://crm.example.com/")).toBe("https://crm.example.com/brand/x.png");
  });
});
