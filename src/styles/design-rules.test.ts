import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The agreed interface direction, enforced rather than remembered.
 *
 * These are not style preferences — each one is a decision from the brief
 * that a later change could quietly undo. A test is cheaper than noticing
 * six months later that the product has grown three blues and a gradient.
 *
 * REWRITTEN IN NOVEMBER 2026 with the direction itself. Three of these
 * rules enforced the old brief — no gradients, one shadow, a dark top
 * bar — and the company replaced that brief with a reference design. The
 * rules were not deleted when they started failing: a rule removed
 * because it was inconvenient is a rule that was never enforcing
 * anything. Each one below either still says what it said, or says the
 * new decision in the same enforceable form. What did NOT change is the
 * discipline underneath: a fixed, named set of places colour and depth
 * may be used, and no loose hex anywhere outside the token file.
 */

const DIR = "src/styles";
const files = readdirSync(DIR).filter((f) => f.endsWith(".css"));
const css = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));
const all = Object.values(css).join("\n");

/** Strip comments so prose about a rule never trips the rule. */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");
const allCode = code(all);

describe("no decoration", () => {
  it("uses gradients only where the direction allows one", () => {
    // THE OLD RULE WAS "NONE", and it is now a list. The reference design
    // asked for a warm band behind the dashboard title and a glow at the
    // foot of the rail, so a blanket ban would have been a rule the
    // product broke on day one. A LIST still does the work a ban did:
    // somebody adding a gradient to a button has to come here and argue
    // for it, which is the whole point of the test.
    //
    // Each entry earns its place:
    //   -wrap::after  the fade at the edge of a scrolling region — it says
    //                 "there is more this way", which is information
    //   .skel         the shimmer standing in for content still loading
    //   .hero         the band behind the dashboard title
    //   .hero::after  its scrim, which is what keeps the words legible
    //   .rail-glow    the warm glow at the foot of the navigation rail
    //   .signin-glow  the same glow on the sign-in panel, so the front
    //                 door and the rail are recognisably one place
    //   .rail-ink     the wash behind the current rail item
    //   .bar          the chart bars, and the darker current month
    const ALLOWED = /-wrap::after$|^\.skel$|^\.hero$|^\.hero::after$|^\.rail-glow$|^\.signin-glow$|^\.rail-ink$|^\.bar$|^\.bar\.is-last$/;
    const uses = [...allCode.matchAll(/([^{}]*)\{[^}]*(linear|radial|conic)-gradient[^}]*\}/g)]
      .map((m) => (m[1] ?? "").trim().split("\n").pop()?.trim() ?? "");
    for (const selector of uses) {
      expect(selector, `gradient in ${selector} — add it to ALLOWED above, with a reason`).toMatch(ALLOWED);
    }
  });

  it("defines two shadow tokens and uses no ad-hoc box-shadows", () => {
    // TWO NOW, NOT ONE. --shadow-1 is the resting lift of a card on the
    // canvas, which the reference design's depth comes from; --shadow-2
    // is something genuinely floating above the page, a menu or a dialog.
    // A third would be a judgement nobody could repeat, so the list is
    // closed and this test is what closes it.
    //
    // inset is the exception: the bar down the side of the current rail
    // item is a shadow by syntax and a border by intent.
    const shadows = allCode.match(/box-shadow:\s*([^;]+);/g) ?? [];
    for (const decl of shadows) {
      expect(decl, decl).toMatch(/var\(--shadow-[12]\)|var\(--lift\)|var\(--accent-weak\)|^box-shadow:\s*inset|none/);
    }
  });

  it("carries no emoji in the stylesheets", () => {
    expect(allCode).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

describe("nothing scrolls sideways", () => {
  it("does not freeze the page head's title block when there are no actions", () => {
    // A page head with one child matches :first-child AND :last-child. The
    // later rule used to win, sizing the title block to its content and
    // giving every actionless screen a horizontal scrollbar on a phone.
    const shell = code(css["shell.css"] ?? "");
    expect(shell).toMatch(/\.page-head > :last-child:not\(:first-child\)/);
  });
});

describe("one accent", () => {
  it("declares a single accent hue", () => {
    const tokens = code(css["tokens.css"] ?? "");
    const accents = [...tokens.matchAll(/--accent[\w-]*:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1]);
    // accent, accent-hover, accent-weak, accent-rule — four shades, one hue.
    expect(accents.length).toBeGreaterThan(0);
    expect(accents.length).toBeLessThanOrEqual(4);
  });

  it("hard-codes no hex colours outside the token file", () => {
    for (const [name, text] of Object.entries(css)) {
      if (name === "tokens.css") continue;
      const hexes = code(text)
        .replace(/url\("data:[^"]*"\)/g, "")   // the SVG caret carries its own stroke colour
        .match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];
      expect(hexes, `${name} should use tokens, found ${hexes.join(", ")}`).toEqual([]);
    }
  });
});

describe("the chrome is dark and the content is light", () => {
  /* THE DARK CHROME MOVED. It used to be the top bar and the row of app
     tabs; it is the left rail now, and the top bar went white — so the
     top bar's own labels correctly use content ink and are no longer
     listed here. The rule itself is unchanged: whatever sits on
     background: var(--shell) must not be painted in content ink. */
  /* The bottom bar on a phone is NOT on this list: it is
     background: var(--surface), white, and its labels correctly use
     content ink. Listing it was this test's own mistake, caught by
     itself on the first run after the rewrite. */
  const CHROME = [
    ".rail", ".rail-name", ".rail-tag", ".rail-item", ".rail-item:hover",
    ".rail-label", ".rail-group-label", ".rail-brand",
  ];

  it("never paints content ink onto the dark shell", () => {
    /* --ink is for content on white cards. On near-black it is invisible,
       and invisible is not something a screenshot review catches
       reliably — somebody has to notice that a label which was always
       there is now missing. A rule may still use --ink if it paints
       itself a light background first. */
    const text = (css["shell.css"] ?? "") + "\n" + (css["components.css"] ?? "");
    const offenders: string[] = [];

    for (const match of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = (match[1] ?? "").trim().split("\n").pop()?.trim() ?? "";
      const body = match[2] ?? "";
      if (!CHROME.some((c) => selector.split(",").some((part) => part.trim() === c))) continue;
      const paintsItselfLight = /background:[^;]*var\(--surface/.test(body);
      if (paintsItselfLight) continue;
      if (/color:\s*var\(--ink/.test(body) || /background:\s*var\(--ink/.test(body)) {
        offenders.push(selector);
      }
    }
    expect(offenders, `these sit on the charcoal shell and use content ink: ${offenders.join(", ")}`).toEqual([]);
  });

  it("gives the shell an ink of its own, light enough to read on it", () => {
    const tokens = code(css["tokens.css"] ?? "");
    expect(tokens).toMatch(/--shell-ink:\s*#[0-9A-Fa-f]{6}/);
    expect(tokens).toMatch(/--shell-ink-2:\s*#[0-9A-Fa-f]{6}/);
  });
});

describe("colour means something", () => {
  it("names its semantic tokens by meaning, not by hue", () => {
    const tokens = code(css["tokens.css"] ?? "");
    for (const name of ["--good", "--warn", "--bad", "--neutral"]) {
      expect(tokens).toContain(name + ":");
    }
    // No token is named for its colour — "--green" invites decorative use.
    expect(tokens).not.toMatch(/--(green|red|amber|yellow|orange|purple|teal)\s*:/);
  });

  it("gives every state chip a dot as well as a hue", () => {
    // Colour alone is not a signal for everyone reading this screen.
    expect(code(css["components.css"] ?? "")).toContain(".chip-dot");
  });
});

describe("figures align", () => {
  it("sets tabular numerals globally and on every numeric surface", () => {
    const base = code(css["base.css"] ?? "");
    const comp = code(css["components.css"] ?? "");
    expect(base).toMatch(/body\s*\{\s*font-variant-numeric:\s*tabular-nums/);
    expect(comp).toMatch(/\.tile-value[^}]*tabular-nums/);
    expect(comp).toMatch(/\.table \.num[^}]*tabular-nums/);
    expect(comp).toMatch(/\.input-num[^}]*tabular-nums/);
  });
});

describe("mobile", () => {
  it("turns modals into bottom sheets", () => {
    const comp = code(css["components.css"] ?? "");
    const mobile = comp.slice(comp.indexOf("@media (max-width: 720px)"));
    expect(mobile).toContain("align-items: flex-end");
    expect(mobile).toMatch(/border-radius:\s*14px 14px 0 0/);
  });

  it("hides the document preview rather than scaling an unreadable A4 page", () => {
    const shell = code(css["shell.css"] ?? "");
    const mobile = shell.slice(shell.indexOf("@media (max-width: 960px)"));
    expect(mobile).toMatch(/\.split-preview\s*\{\s*display:\s*none/);
  });

  it("lets the summary bar reflow — its column count is a custom property", () => {
    // An inline grid-template-columns beats every media query: five columns
    // stayed pinned onto a 390px phone and wrapped every figure mid-value.
    const comp = code(css["components.css"] ?? "");
    expect(comp).toMatch(/\.summary\s*\{[^}]*var\(--summary-cols/);
    // STILL TWO ON THE NARROWEST PHONE, which survived the redesign: four
    // headline figures at one per screen is four screens before any
    // content, and the tiles grew taller, not shorter.
    const mobile = comp.slice(comp.lastIndexOf("@media (max-width: 620px)"));
    expect(mobile).toMatch(/\.summary\s*\{\s*grid-template-columns:\s*repeat\(2/);
  });

  it("never drops stat tiles to one per row", () => {
    // Five KPIs at one per screen is five screens before any content.
    expect(code(css["base.css"] ?? "")).toMatch(/\.grid-tiles\s*\{[^}]*auto-fit/);
  });

  it("honours reduced motion", () => {
    expect(allCode).toContain("prefers-reduced-motion: reduce");
  });
});
