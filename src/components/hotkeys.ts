import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts.
 *
 * One listener per registered chord, on `document`, so a shortcut works
 * wherever focus happens to be — a salesperson halfway down a form should
 * not have to click somewhere neutral before Ctrl+S will save.
 *
 * TYPING ALWAYS WINS. A bare letter is ignored while the caret is in a
 * field: `/` means "jump to search" on a list, and a slash in an address.
 * Chords carrying Ctrl or Cmd are honoured everywhere, because Ctrl+S has
 * meant "save what I am typing" for forty years and interrupting a form is
 * exactly when it is pressed.
 */

/** Ctrl on Windows and Linux, Cmd on a Mac — the same key to the person
 *  pressing it, so one flag covers both. */
export const isMod = (e: KeyboardEvent): boolean => e.ctrlKey || e.metaKey;

/** Rendered in the cheatsheet and in button hints. */
export const MOD_LABEL = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
  ? "⌘"
  : "Ctrl";

/** The tags that eat keystrokes. */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** The decision, with no DOM in it, so the rule that protects typing can be
 *  tested without a browser — a regression here is silent and awful: "/"
 *  would stop being typable in an address field. */
export const tagIsTyping = (tagName: string, contentEditable = false): boolean =>
  TYPING_TAGS.has(tagName.toUpperCase()) || contentEditable;

/** The same decision for a real event target. */
export const isTypingTarget = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && tagIsTyping(el.tagName, el.isContentEditable);

export interface Hotkey {
  /** `e.key`, compared case-insensitively. */
  key: string;
  /** Requires Ctrl/Cmd. */
  mod?: boolean;
  shift?: boolean;
  /** Fire even when the caret is in a field. Implied by `mod`. */
  whileTyping?: boolean;
  run: (e: KeyboardEvent) => void;
}

/**
 * Bind a set of shortcuts for as long as the component is mounted.
 *
 * `enabled` is checked at fire time rather than by re-binding, so a screen
 * can switch its shortcuts off — while a modal is open, say — without the
 * listener churning on every render.
 */
export function useHotkeys(keys: Hotkey[], enabled = true): void {
  /* Held in a ref so the effect binds ONCE. Re-binding whenever a caller
     passes a new array literal would tear the listener down and rebuild it
     on every keystroke that re-renders the screen. */
  const latest = useRef(keys);
  latest.current = keys;
  const on = useRef(enabled);
  on.current = enabled;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!on.current) return;
      const typing = isTypingTarget(e.target);
      for (const k of latest.current) {
        if (e.key.toLowerCase() !== k.key.toLowerCase()) continue;
        if (!!k.mod !== isMod(e)) continue;
        if (k.shift !== undefined && k.shift !== e.shiftKey) continue;
        if (typing && !k.mod && !k.whileTyping) continue;
        e.preventDefault();
        k.run(e);
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}

/** What the cheatsheet lists. Kept beside the hook so a shortcut and its
 *  documentation cannot drift apart. */
export const SHORTCUTS: ReadonlyArray<{ keys: string; what: string; where: string }> = [
  { keys: "?", what: "Show this list", where: "Anywhere" },
  { keys: "/", what: "Jump to search", where: "Any list" },
  /* One row, because they do the same thing. Two rows implying otherwise is
     the kind of small lie that makes people stop trusting the whole list. */
  { keys: `${MOD_LABEL} + S  ·  ${MOD_LABEL} + Enter`, what: "Save what is open", where: "Any form" },
  { keys: "Esc", what: "Close — asks first if you have unsaved edits", where: "Any panel" },
  { keys: `${MOD_LABEL} + P`, what: "Open the PDF", where: "A quotation, PO or invoice" },
];
