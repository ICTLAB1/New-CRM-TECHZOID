import { describe, expect, it } from "vitest";
import { DEFAULT_CERTIFICATIONS, DEFAULT_PARTNER_DESIGNATIONS, DEFAULT_TECHNOLOGY_PARTNERS } from "./brandDefaults";

describe("supplied partner assets", () => {
  it("carries the two official badges as designations", () => {
    expect(DEFAULT_PARTNER_DESIGNATIONS.map((a) => a.label)).toEqual([
      "Microsoft Solutions Partner",
      "Adobe Certified Reseller",
    ]);
  });

  it("embeds real artwork with its natural size, so aspect ratio survives", () => {
    for (const a of [...DEFAULT_PARTNER_DESIGNATIONS, ...DEFAULT_TECHNOLOGY_PARTNERS]) {
      expect(a.data.startsWith("data:image/png;base64,"), a.label).toBe(true);
      expect(a.w, a.label).toBeGreaterThan(0);
      expect(a.h, a.label).toBeGreaterThan(0);
    }
  });

  it("never labels HP or Acer as a partner", () => {
    // brand-assets/README.md is explicit: no approved partner badge was
    // supplied for either, so they are plain brand logos.
    const labels = DEFAULT_TECHNOLOGY_PARTNERS.map((a) => a.label);
    expect(labels).toContain("HP");
    expect(labels).toContain("Acer");
    expect(labels).not.toContain("HP Partner");
    expect(labels.filter((l) => /^(HP|Acer)\b/.test(l)).every((l) => !/partner/i.test(l))).toBe(true);
  });

  it("keeps the Cisco badge's supplied wording", () => {
    expect(DEFAULT_TECHNOLOGY_PARTNERS.map((a) => a.label)).toContain("Cisco Partner");
  });
});

describe("certifications", () => {
  it("names the third standard as IT Service Management, not food safety", () => {
    // The supplied reference strip read "ISO 22000-1:2018 — Food Safety
    // Management System". That is a different standard from the ISO/IEC
    // 20000-1 named by the spec and the individual asset, and a food-safety
    // claim on an IT quotation would be false. Confirmed with the owner.
    const third = DEFAULT_CERTIFICATIONS[2]!;
    expect(third.label).toBe("ISO/IEC 20000-1:2018");
    expect(third.caption).toBe("IT Service Management System");
    for (const c of DEFAULT_CERTIFICATIONS) {
      expect(c.label).not.toContain("22000");
      expect(c.caption.toLowerCase()).not.toContain("food");
    }
  });

  it("lists the three certifications with their full scope names", () => {
    expect(DEFAULT_CERTIFICATIONS.map((c) => c.label)).toEqual([
      "ISO 9001:2015", "ISO/IEC 27001:2022", "ISO/IEC 20000-1:2018",
    ]);
    for (const c of DEFAULT_CERTIFICATIONS) {
      expect(c.caption.endsWith("System"), c.label).toBe(true);
    }
  });

  it("carries no artwork — the renderer draws these", () => {
    // The supplied badge PNGs had the number overflowing its ring, clipped at
    // the image edge and colliding with the caption.
    for (const c of DEFAULT_CERTIFICATIONS) {
      expect(c).not.toHaveProperty("data");
      expect(c).not.toHaveProperty("logo");
    }
  });

  it("leaves the licence/certificate number blank rather than inventing one", () => {
    // Never fabricate: an admin fills this in once the real registrar
    // numbers are known.
    for (const c of DEFAULT_CERTIFICATIONS) {
      expect(c).not.toHaveProperty("certNo");
    }
  });
});
