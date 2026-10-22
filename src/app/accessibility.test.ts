import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every .tsx under src/, so a new screen is covered the day it lands. */
function tsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) tsxFiles(path, found);
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) found.push(path);
  }
  return found;
}

const FILES = tsxFiles("src").map((path) => [path, readFileSync(path, "utf8")] as const);

describe("a keyboard can reach everything a mouse can", () => {
  it("gives every clickable row its own focusable control", () => {
    /* A <tr onClick> hands a mouse an enormous target and a keyboard
       nothing at all — the record simply cannot be opened without one.
       Invisible in review because the screen looks and behaves correctly
       for whoever is testing it with a trackpad.

       The row keeps its onClick as a convenience; what it must also have is
       a real control inside it. `row-open` is that control. */
    const offenders: string[] = [];
    for (const [path, text] of FILES) {
      for (const match of text.matchAll(/<tr\b[^>]*onClick[^>]*>([\s\S]*?)<\/tr>/g)) {
        const row = match[1] ?? "";
        const hasControl = /className="row-open"/.test(row)
          || /<button\b/.test(row) || /<a\b[^>]*href/.test(row);
        if (!hasControl) offenders.push(path);
      }
    }
    expect([...new Set(offenders)], `clickable rows with no keyboard path: ${offenders.join(", ")}`).toEqual([]);
  });

  it("never hangs a click on a cell with no way to focus it", () => {
    /* <td onClick> has the same problem and is easier to miss, because one
       cell looks like a deliberate affordance rather than a whole row. */
    const offenders: string[] = [];
    for (const [path, text] of FILES) {
      for (const match of text.matchAll(/<td\b([^>]*)onClick/g)) {
        const attrs = match[1] ?? "";
        /* The handler's own text, not the tag's: `[^>]*>` stops at the `>`
           of an arrow function, so reading to the tag's close misses what
           the handler actually does. Found by this test reporting a cell
           that was already fine. */
        const after = text.slice((match.index ?? 0), (match.index ?? 0) + 200);
        if (/stopPropagation/.test(after)) continue;
        if (/role=|tabIndex/.test(attrs)) continue;
        offenders.push(`${path}: ${(match[0] ?? "").slice(0, 60)}`);
      }
    }
    expect(offenders, `cells a keyboard cannot reach: ${offenders.join(" | ")}`).toEqual([]);
  });

  it("names every icon-only button for a screen reader", () => {
    /* A button whose whole content is a glyph announces as "button" and
       nothing else. ✕ is the common one — dismiss, remove, close. */
    const offenders: string[] = [];
    for (const [path, text] of FILES) {
      for (const match of text.matchAll(/<button\b([^>]*)>\s*([✕×✓▾←→⋯]|&times;)\s*<\/button>/g)) {
        if (!/aria-label=|title=/.test(match[1] ?? "")) offenders.push(`${path}: ${match[2]}`);
      }
    }
    expect(offenders, `icon buttons with no name: ${offenders.join(", ")}`).toEqual([]);
  });
});
