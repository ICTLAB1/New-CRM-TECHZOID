/**
 * Stopping the page behind a dialog from scrolling — once, for however many
 * dialogs are open.
 *
 * WHAT WENT WRONG, because it is not obvious from reading the old two
 * lines. Every modal saved `body.style.overflow`, set it to "hidden", and
 * put the saved value back when it closed. With one dialog that is
 * correct. With two it depends on the order they close in:
 *
 *   dialog A opens   saves ""        body = hidden
 *   dialog B opens   saves "hidden"  body = hidden
 *   A closes first   puts back ""    body scrolls again, under an open B
 *   B closes         puts back "hidden"   ← and there it stays
 *
 * The page is then unscrollable with no dialog on screen and nothing to
 * click to undo it. `html, body, #root { height: 100% }`, so the content
 * below the fold is not merely unreachable by scrolling — it is clipped
 * away, which is why the buttons under the document editor stopped
 * responding too. Only a reload cleared it. That is exactly what was
 * reported: "pages are getting hang, not moving upward and download, when
 * i press refresh then it works".
 *
 * A COUNT, NOT A SAVED VALUE PER DIALOG. The first lock records what the
 * page had and hides; the last one to let go puts that back. Order stops
 * mattering, which is the point — a dialog cannot know what else is open.
 */

export interface ScrollLockTarget {
  get(): string;
  set(value: string): void;
}

/** The counting, with the page injected — so it can be tested without one. */
export function makeScrollLock(target: ScrollLockTarget): () => () => void {
  let held = 0;
  let saved = "";

  return function lock(): () => void {
    if (held === 0) {
      saved = target.get();
      target.set("hidden");
    }
    held += 1;

    /* Releasing twice must not decrement twice. React runs an effect's
       cleanup once, but a cleanup captured and called by hand — or by a
       double-invoked effect in development's strict mode — would otherwise
       take the count below what is actually open and let the page scroll
       behind a dialog that is still there. */
    let released = false;
    return () => {
      if (released) return;
      released = true;
      held -= 1;
      if (held === 0) target.set(saved);
    };
  };
}

const body: ScrollLockTarget = {
  /* Guarded because this module is imported by code that is also rendered
     to a string on the server, where there is no document. */
  get: () => (typeof document === "undefined" ? "" : document.body.style.overflow),
  set: (value) => { if (typeof document !== "undefined") document.body.style.overflow = value; },
};

/**
 * Hold the page still. Returns the release — call it when the dialog is
 * gone, and the page comes back only once nothing else is holding it.
 */
export const lockBodyScroll = makeScrollLock(body);
