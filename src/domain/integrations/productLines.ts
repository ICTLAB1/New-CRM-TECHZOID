import type { EmailProductGroup } from "./emailTemplate";
import { absoluteUrl } from "./emailIdentity";

/**
 * What TechZoid supplies, said once.
 *
 * WHY IT IS HERE AND NOT IN THE EMAIL THAT USES IT. The company profile
 * mail is the first thing to print this list, and it will not be the last —
 * an outreach template, the customer portal and the profile PDF all want
 * the same lines, and three copies of them is three chances for one to go
 * stale after a vendor is added or a product is dropped. Change this file
 * and every place that lists our lines changes with it.
 *
 * THE WORDING IS THE COMPANY'S OWN, supplied verbatim. Nothing here
 * describes a capability that was not stated: no vendor we do not carry, no
 * partner level, no claim about pricing or support. A list of what we sell
 * is a claim a customer will hold us to, and the one place a reseller
 * cannot afford to be approximately right.
 */

/**
 * The vendors' own marks.
 *
 * ARTWORK, NEVER APPROXIMATION. Each of these is the vendor's own logo,
 * supplied by the company that holds those relationships, and committed to
 * `public/brand/`. Nothing here is drawn, traced or reconstructed, and a
 * vendor whose artwork is not on disk simply goes without one — see the
 * guard in productLines.test.ts, which is the same rule the signature strip
 * exists under after it spent weeks naming a file nobody had uploaded.
 *
 * FLATTENED ONTO WHITE before being committed. A transparent logo looks
 * right in a white email and disappears in a dark-mode client, where black
 * wordmarks sit on near-black.
 */
const LOGO_PATHS = {
  microsoft: "/brand/vendor-microsoft.png",
  autodesk: "/brand/vendor-autodesk.png",
  adobe: "/brand/vendor-adobe.png",
} as const;

/** Every path above, for the test that insists each is a real file. */
export const VENDOR_LOGO_PATHS: readonly string[] = Object.values(LOGO_PATHS);

/**
 * The vendors' own brand colours, for the rule down the side of each panel.
 *
 * A COLOUR IS NOT AN IMAGE, which is the whole reason it is here. The rule
 * is a table cell with a background, so it renders in every client whether
 * or not the reader allows pictures — the panel keeps its identity in the
 * case where the logo does not load. Each is the vendor's published brand
 * colour, used to label that vendor's own products and nothing else.
 */
const ACCENTS = {
  microsoft: "#0067B8",
  autodesk: "#0696D7",
  adobe: "#EB1000",
  /* The hardware line is not one vendor's, so it carries the company's own
     accent rather than borrowing a manufacturer's colour. */
  hardware: "#76550A",
} as const;

/**
 * The lines, in the order a customer meets them.
 *
 * BULLETS, NOT A SENTENCE. This began as one run-on line per vendor, which
 * is how a person writes it and not how a purchase manager reads it: they
 * are scanning for the one product they are about to buy, and a list lets
 * them find it without reading the rest. The sentence survives as `detail`,
 * one line above the list, because it says what the group is for.
 */
const GROUPS: ReadonlyArray<{
  name: string;
  heading: string;
  detail: string;
  bullets: readonly string[];
  /** A commercial fact about the whole group, printed under its list. */
  note?: string;
  /** Absent where the company holds no artwork for the line — see the
   *  hardware panel. The block prints the name in the accent instead. */
  logo?: string;
  accent: string;
  /** Drawn width in px — the marks differ in proportion, so matching
   *  widths would make the compact ones look oversized. */
  width?: number;
}> = [
  {
    name: "Microsoft",
    heading: "Microsoft 365 & perpetual licensing",
    detail: "Subscription-based productivity, collaboration and enterprise licensing.",
    bullets: [
      "Microsoft 365 Business Basic, Standard & Premium",
      "Microsoft 365 E3 & E5 / Office 365 E3 & E5",
      "Microsoft 365 Apps for Business & Enterprise",
      "Office LTSC Standard 2024 & Professional Plus 2024",
      "Windows 11 Pro & Enterprise licensing",
      "Windows Server Standard & Datacenter",
      "Microsoft Project & Visio licensing",
    ],
    note: "Available as a subscription or as a one-time perpetual licence.",
    logo: LOGO_PATHS.microsoft,
    accent: ACCENTS.microsoft,
    width: 100,
  },
  {
    name: "Autodesk",
    heading: "Autodesk professional software",
    detail: "Design, engineering, architecture and construction software.",
    bullets: [
      "AutoCAD & AutoCAD LT",
      "Architecture, Engineering & Construction Collection",
      "Revit & Civil 3D",
      "3ds Max & Maya",
      "Inventor & Fusion",
      "Navisworks Manage",
      "Product Design & Manufacturing Collection",
    ],
    logo: LOGO_PATHS.autodesk,
    accent: ACCENTS.autodesk,
    width: 104,
  },
  {
    /* NO LOGO, AND THAT IS DELIBERATE. This panel covers three
       manufacturers and the repository holds artwork for one of them. A
       single HP mark over a list that also names Dell and Lenovo reads as
       a claim about HP alone, and the other two would have to be drawn —
       which is forgery, not branding. With no logo the block prints the
       panel's name in the accent colour instead, which is exactly the
       fallback it was built with. Drop real artwork into public/brand/ and
       add `logo` here if the manufacturers supply it. */
    name: "Hardware",
    heading: "Hardware & IT infrastructure",
    detail: "Business hardware, security appliances and everything that goes with them.",
    bullets: [
      "HP, Dell and Lenovo laptops, desktops and servers",
      "Firewalls and network security appliances",
      "IT accessories and peripherals",
    ],
    accent: ACCENTS.hardware,
  },
  {
    name: "Adobe",
    heading: "Adobe creative & business applications",
    detail: "Creative, document management, PDF and digital media applications.",
    bullets: [
      "Adobe Creative Cloud All Apps",
      "Adobe Acrobat Pro",
      "Adobe Photoshop & Illustrator",
      "Adobe Premiere Pro & After Effects",
      "Adobe InDesign",
      "Adobe Substance 3D applications",
      "Adobe Express and other business applications",
    ],
    logo: LOGO_PATHS.adobe,
    accent: ACCENTS.adobe,
    width: 86,
  },
];

/**
 * The block, ready for an email.
 *
 * `origin` makes the logo URLs absolute, because a mail client has no page
 * for a relative path to be relative to. WITHOUT ONE THE LOGOS ARE DROPPED
 * rather than written as bare paths: a src of "/brand/vendor-adobe.png" in
 * an inbox is a broken image, and a broken image is worse than no image —
 * that is the whole lesson of the signature strip. The words, the colour
 * rule and the bullets are printed either way, which is what the block is
 * actually for.
 */
export function emailProductGroups(origin?: string): EmailProductGroup[] {
  const base = (origin ?? (typeof window === "undefined" ? "" : window.location.origin)).trim();

  return GROUPS.map((g) => ({
    name: g.name,
    heading: g.heading,
    detail: g.detail,
    bullets: g.bullets,
    note: g.note,
    accent: g.accent,
    /* The alt text is the vendor's name on its own — what a reader in
       Outlook sees in place of the picture. It reads as the label the mark
       is, not as a sentence apologising for a missing image. */
    logo: g.logo && base
      ? { src: absoluteUrl(g.logo, base), alt: g.name, width: g.width ?? 100 }
      : null,
  }));
}

/** The same lines as plain sentences, for anywhere that is not an email —
 *  a WhatsApp message, a portal page, a PDF. */
export const productSentences = (): string[] =>
  GROUPS.map((g) => `${g.heading}: ${g.bullets.join(", ")}.`);
