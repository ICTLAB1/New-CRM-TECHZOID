import type { Transition, Variants } from "motion/react";

/**
 * The timings and shapes every animated component in the CRM shares.
 *
 * WHY ONE FILE. Variants written at the point of use drift: one list
 * settles in 180ms and the one beside it in 320, a row leaves upwards here
 * and sideways there, and the product stops feeling like one piece of
 * software. These are the four or five movements this app actually makes.
 *
 * WHAT THEY ARE FOR. Every one is opacity and transform only — the two
 * properties a browser can animate on the compositor without laying the
 * page out again. Nothing here animates height, width, top or left; a list
 * that reflows sixty times a second is how an animation costs a frame
 * budget it was supposed to be decorating.
 *
 * REDUCED MOTION IS NOT HANDLED HERE. MotionConfig in main.tsx is set to
 * `reducedMotion="user"`, which strips transforms from every one of these
 * and keeps the opacity, for the whole tree at once. Re-checking the media
 * query in each component would be a second answer to a settled question.
 */

/** The house curve: quick to leave, long to land. */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const DUR = {
  /** A press, a hover, a tick — faster than thought. */
  quick: 0.12,
  /** Something arriving on screen. */
  enter: 0.24,
  /** And leaving: shorter, because nobody waits to watch a thing go. */
  exit: 0.16,
  /** A panel or a page. */
  page: 0.3,
} as const;

export const ease: Transition = { duration: DUR.enter, ease: EASE };

/**
 * A row in a list that can be added to, removed from and reordered.
 *
 * Collapsing the margin on exit is what stops the rows below snapping up
 * before the leaving one has gone — `layout` then carries them into the
 * gap instead.
 */
export const listRow: Variants = {
  initial: { opacity: 0, y: -8, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.enter, ease: EASE } },
  exit: {
    opacity: 0,
    y: 4,
    scale: 0.985,
    transition: { duration: DUR.exit, ease: EASE },
  },
};

/** A panel, a card, a block of fields appearing in place. */
export const fadeUp: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.enter, ease: EASE } },
  exit: { opacity: 0, y: 6, transition: { duration: DUR.exit, ease: EASE } },
};

/** Something that belongs to the control that opened it. */
export const pop: Variants = {
  initial: { opacity: 0, y: -4, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.enter, ease: EASE } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: DUR.exit, ease: EASE } },
};

/**
 * A confirmation: the tick, the number, the line that says it worked.
 *
 * A spring rather than a curve, because this is the one moment in a form
 * worth a little overshoot — and `stiffness` high enough that it reads as
 * crisp rather than bouncy, which the brief rules out and which would make
 * a finance app look like a game.
 */
export const confirm: Variants = {
  initial: { opacity: 0, scale: 0.8 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 520, damping: 26, mass: 0.7 },
  },
  exit: { opacity: 0, scale: 0.96, transition: { duration: DUR.exit, ease: EASE } },
};

/** Children arrive one after another rather than all at once. */
export const stagger = (gap = 0.04): Variants => ({
  animate: { transition: { staggerChildren: gap } },
});

/** The movement a list row makes as its neighbours change around it. */
export const layoutSpring: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 38,
  mass: 0.9,
};
