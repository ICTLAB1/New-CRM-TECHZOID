import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The agreed interface direction, enforced rather than remembered.
 *
 * These are not style preferences — each one is a decision from the brief
 * that a later change could quietly undo. A test is cheaper than noticing
 * six months later that the product has grown three blues and a gradient.
 */

const DIR = "src/styles";
const files = readdirSync(DIR).filter((f) => f.endsWith(".css"));
const css = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));
const all = Object.values(css).join("\n");

/** Strip comments so prose about a rule never trips the rule. */
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");
const allCode = code(all);

describe("no decoration", () => {
  it("uses gradients only as scroll affordances, never as decoration", () => {
    // "No gradients" is explicit in the brief, and v1's primary button had
    // one. The single permitted use is the fade at the edge of a scrolling
    // region: it carries information (there is more this way) rather than
    // decorating a surface. Every occurrence must be inside a *-wrap::after.
    const uses = [...allCode.matchAll(/([^{}]*)\{[^}]*(linear|radial|conic)-gradient[^}]*\}/g)]
      .map((m) => (m[1] ?? "").trim().split("\n").pop()?.trim() ?? "");
    // The one other use: the shimmer on a skeleton loader (.skel), asked for
    // in the motion brief. It stands in for content that is loading — it
    // carries information too, and it is gone the moment the content lands.
    for (const selector of uses) {
      expect(selector, `gradient in ${selector}`).toMatch(/-wrap::after$|^\.skel$/);
    }
  });

  it("defines exactly one shadow token and uses no ad-hoc box-shadows", () => {
    // Depth is for things genuinely floating: modals, sheets, toasts — and,
    // since the motion brief, the subtle lift under the pointer. All of it
    // comes from the --lift / --elev-N tokens; never an ad-hoc shadow.
    const shadows = allCode.match(/box-shadow:\s*([^;]+);/g) ?? [];
    for (const decl of shadows) {
      expect(decl, decl).toMatch(/var\(--lift\)|var\(--elev-\d\)|var\(--accent-weak\)|none/);
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
  /* Selectors painted on .global-header or .app-nav. Both are
     background: var(--shell), which is charcoal. */
  const CHROME = [
    ".global-header", ".app-nav", ".app-name", ".app-tab", ".app-tab:hover",
    ".app-tab-sub", ".app-caret", ".brand-name", ".topbar-crumb", ".waffle i",
  ];

  it("never paints content ink onto the dark shell", () => {
    /* --ink is for content on white cards. On charcoal it is invisible, and
       invisible is not something a screenshot review catches reliably —
       somebody has to notice a label that was always there is now missing.
       A rule may still use --ink if it paints itself a light background
       first, which is what the search field does. */
    const text = css["shell.css"] ?? "";
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
    const mobile = comp.slice(comp.indexOf("@media (max-width: 620px)"));
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
