import { useEffect, useRef, useState } from "react";

/**
 * Keep something mounted long enough to animate itself away.
 *
 * React unmounts the instant a condition flips, so a dialog that fades in
 * over 180ms vanishes in 0ms — which is exactly the half-finished feeling of
 * a screen that animates on the way in and teleports on the way out. This
 * holds the element in the tree for the length of its exit, and reports
 * which phase it is in so the right class can be applied.
 *
 * Timer-driven rather than `animationend`-driven on purpose: `animationend`
 * never fires when the animation is suppressed (reduced motion, a
 * background tab, a browser that skips it), and a dialog stuck permanently
 * on screen is a far worse failure than one that leaves a frame early.
 */

export type Phase = "entering" | "open" | "leaving" | "closed";

/** How long an exit is given before the element is dropped. Must not be
 *  shorter than the CSS it pairs with, or the element is removed mid-fade. */
export const EXIT_MS = 140;

/** True when the person using this has asked for less movement. Read at call
 *  time rather than cached: it can change while the app is open. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface Presence {
  /** Render the element while this is true. */
  mounted: boolean;
  phase: Phase;
  /** Append to the element's class: "" while open, "is-leaving" on the way
   *  out. */
  className: string;
}

export function usePresence(open: boolean, exitMs: number = EXIT_MS): Presence {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<Phase>(open ? "open" : "closed");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }

    if (open) {
      setMounted(true);
      setPhase("open");
      return;
    }

    if (!mounted) { setPhase("closed"); return; }

    /* Reduced motion gets no exit at all — there is nothing to wait for, and
       holding a dismissed dialog on screen for 140ms would be the opposite
       of what was asked for. */
    if (prefersReducedMotion()) {
      setMounted(false);
      setPhase("closed");
      return;
    }

    setPhase("leaving");
    timer.current = setTimeout(() => {
      setMounted(false);
      setPhase("closed");
      timer.current = null;
    }, exitMs);

    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, exitMs]);

  /* Unmounting mid-exit must not leave a timer holding a setState. */
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return { mounted, phase, className: phase === "leaving" ? " is-leaving" : "" };
}
