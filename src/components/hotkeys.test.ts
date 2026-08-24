import { describe, expect, it } from "vitest";
import { MOD_LABEL, SHORTCUTS, isMod, tagIsTyping } from "./hotkeys";

/**
 * The hook itself needs a DOM and a mounted component; what is worth pinning
 * without one is the modifier rule and the promise the cheatsheet makes —
 * a shortcut list that says something the app does not do is worse than no
 * list at all.
 */

const ev = (over: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ ctrlKey: false, metaKey: false, shiftKey: false, key: "a", ...over }) as KeyboardEvent;

describe("the modifier", () => {
  it("accepts Ctrl and Cmd alike — one key to the person pressing it", () => {
    expect(isMod(ev({ ctrlKey: true }))).toBe(true);
    expect(isMod(ev({ metaKey: true }))).toBe(true);
  });

  it("is not satisfied by Shift or by nothing", () => {
    expect(isMod(ev({ shiftKey: true }))).toBe(false);
    expect(isMod(ev({}))).toBe(false);
  });
});

describe("the cheatsheet", () => {
  it("names the modifier the way this platform writes it", () => {
    for (const row of SHORTCUTS.filter((r) => r.keys.includes("+"))) {
      expect(row.keys, row.what).toContain(MOD_LABEL);
    }
  });

  it("lists Escape, because that is the one people try first", () => {
    expect(SHORTCUTS.some((r) => r.keys === "Esc")).toBe(true);
  });

  it("says what every shortcut does and where it applies", () => {
    for (const row of SHORTCUTS) {
      expect(row.what.length, row.keys).toBeGreaterThan(3);
      expect(row.where.length, row.keys).toBeGreaterThan(2);
    }
  });

  it("has no duplicate chords", () => {
    // Two rows claiming the same keys means one of them is a lie.
    const seen = SHORTCUTS.map((r) => r.keys);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("typing always wins", () => {
  it("recognises every field a keystroke could belong to", () => {
    // If this ever stops being true, "/" stops being typable in an address.
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(tagIsTyping(tag), tag).toBe(true);
    }
  });

  it("counts a contenteditable, whatever it is made of", () => {
    expect(tagIsTyping("DIV", true)).toBe(true);
  });

  it("leaves ordinary elements alone, so bare shortcuts still fire", () => {
    for (const tag of ["DIV", "BUTTON", "TABLE", "A"]) {
      expect(tagIsTyping(tag), tag).toBe(false);
    }
  });

  it("does not care how the tag name is cased", () => {
    expect(tagIsTyping("input")).toBe(true);
  });
});
