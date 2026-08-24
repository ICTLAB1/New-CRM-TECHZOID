import { describe, expect, it, vi } from "vitest";
import { EXIT_MS, prefersReducedMotion } from "./usePresence";

/**
 * The hook needs a renderer; what is worth pinning without one is the pair
 * of constants the CSS depends on, and the reduced-motion probe — the two
 * places where a wrong answer leaves a dialog stuck on screen.
 */

describe("the exit budget", () => {
  it("is long enough for the CSS exit to finish", () => {
    // components.css uses --t-exit: .14s. Dropping the node sooner removes
    // it mid-fade; much later leaves a dead dialog absorbing clicks.
    expect(EXIT_MS).toBeGreaterThanOrEqual(140);
    expect(EXIT_MS).toBeLessThanOrEqual(250);
  });
});

describe("reduced motion", () => {
  const withMatchMedia = (matches: boolean | null, run: () => void) => {
    const original = globalThis.matchMedia;
    if (matches === null) {
      // @ts-expect-error deliberately removing it
      delete globalThis.matchMedia;
    } else {
      globalThis.matchMedia = vi.fn().mockReturnValue({ matches }) as unknown as typeof matchMedia;
    }
    try { run(); } finally {
      if (original) globalThis.matchMedia = original;
      // @ts-expect-error restoring the absent case
      else delete globalThis.matchMedia;
    }
  };

  it("is honoured when the browser reports it", () => {
    withMatchMedia(true, () => expect(prefersReducedMotion()).toBe(true));
  });

  it("is off when the browser says nothing is preferred", () => {
    withMatchMedia(false, () => expect(prefersReducedMotion()).toBe(false));
  });

  it("assumes motion is fine where matchMedia does not exist", () => {
    // Server rendering and older environments. Assuming REDUCED here would
    // silently disable every exit for everyone; assuming normal degrades to
    // the animation simply not being seen.
    withMatchMedia(null, () => expect(prefersReducedMotion()).toBe(false));
  });
});
