import { BRAND_ASSETS } from "../../assets/brandAssets";

/**
 * Seed values for the settings record's logo strips.
 *
 * These populate a fresh install; the live settings row is the source of
 * truth once an admin has edited it. Governed by brand-assets/README.md:
 *
 *   · Do not invent or alter partner designations.
 *   · Do not label HP or Acer as partners — no approved partner badge was
 *     supplied for either, so they appear as plain brand logos.
 *   · Do not alter official Microsoft / Adobe / Cisco badge wording.
 */

const asset = (a: { w: number; h: number; src: string }, label: string) => ({
  label, data: a.src, w: a.w, h: a.h,
});

/** Official partner badges, used exactly as supplied. */
export const DEFAULT_PARTNER_DESIGNATIONS = [
  asset(BRAND_ASSETS.microsoftSolutionsPartner, "Microsoft Solutions Partner"),
  asset(BRAND_ASSETS.adobeCertifiedReseller, "Adobe Certified Reseller"),
];

/** Brand logos. Cisco carries an approved "Cisco Partner" badge; HP and Acer
 *  are plain logos and must not be captioned as partner designations. */
export const DEFAULT_TECHNOLOGY_PARTNERS = [
  asset(BRAND_ASSETS.ciscoPartner, "Cisco Partner"),
  asset(BRAND_ASSETS.hp, "HP"),
  asset(BRAND_ASSETS.acer, "Acer"),
];

/**
 * Certifications, as the supplied badge artwork.
 *
 * These were drawn natively as text for a while because the earlier badge
 * PNGs had the standard number overflowing its ring and colliding with the
 * caption. The marks supplied since are clean, so the real artwork is used —
 * a certification mark is a controlled logo and a hand-drawn approximation
 * of one is not the mark.
 *
 * `label` is retained beside each image. It is what the plain-text email and
 * any images-off client show, and it is the only place the YEAR of the
 * 27001 certification appears — the supplied 27001 mark does not carry one.
 *
 * The supplied reference strip named the third certification
 * "ISO 22000-1:2018 — Food Safety Management System". That is a different
 * standard from the ISO/IEC 20000-1 named by both the design spec and the
 * individual asset filename, and a food-safety certification on an IT
 * quotation would be a false claim. Confirmed as IT Service Management.
 */
export const DEFAULT_CERTIFICATIONS = [
  { ...asset(BRAND_ASSETS.iso9001, "ISO 9001:2015"), caption: "Quality Management System" },
  { ...asset(BRAND_ASSETS.iso27001, "ISO/IEC 27001:2022"), caption: "Information Security Management System" },
  { ...asset(BRAND_ASSETS.iso20000, "ISO/IEC 20000-1:2018"), caption: "IT Service Management System" },
];
