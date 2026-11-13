import { useEffect, useRef } from "react";

/**
 * Which overlays are open, innermost last.
 *
 * ONE BACK CLOSES ONE THING. Every open overlay has a listener on the same
 * window event, so without this a dialog opened from inside the document
 * editor had both of them answer the same Back — the dialog closed, and the
 * editor underneath closed with it, losing the record somebody was reading.
 * Only the innermost answers; the rest wait their turn.
 */
const stack: symbol[] = [];

/**
 * Back closes what is open, instead of leaving the screen behind it.
 *
 * A document editor or a customer sheet fills the screen, and on a phone
 * Back is a swipe — the gesture people use to close anything. Without this
 * it closed the CRM instead, losing the record underneath as well as the
 * one on top.
 *
 * THE ENTRY KEEPS THE SAME ADDRESS. What is open is not a place: the URL
 * stays on the screen the record belongs to, so Back from here lands on a
 * history entry for the same screen and the view never changes on the way.
 *
 * AND IT TIDIES UP AFTER ITSELF. Closing with the ✕ leaves the entry we
 * pushed sitting in front of the real history, where Forward would reopen
 * nothing and the next Back would be swallowed. So a close that did not
 * come from Back walks that entry off again.
 *
 * `onDismiss` is the SAME handler the close button uses, deliberately: a
 * sheet that asks about unsaved changes must ask about them whichever way
 * somebody leaves it. Returning false means "I did not close" — the entry
 * is then put back, because what is still open still needs one.
 */
export function useDismissOnBack(open: boolean, onDismiss: () => boolean | void): void {
  /* Held in a ref, not read from the closure: the effect below runs once
     per opening, and a handler captured then would close the record that
     was open at the time rather than the one open now. */
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  /* THE TIDY-UP IS DEFERRED, AND THAT IS LOAD-BEARING — twice over.
     React's development mode mounts every effect, tears it down and mounts
     it again, to catch exactly the kind of bug this hook could have. Popped
     synchronously, that teardown removed the entry and the remount's own
     listener then caught the resulting popstate and closed the dialog on
     the spot: every modal in the CRM opened and shut again in the same
     frame. Deferred by a tick, the remount cancels it instead. */
  const pending = useRef<number | null>(null);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;

    if (pending.current !== null) {
      window.clearTimeout(pending.current);
      pending.current = null;
    } else {
      window.history.pushState({ ...(window.history.state ?? {}), crmOverlay: true }, "", window.location.href);
    }

    const token = Symbol("overlay");
    stack.push(token);

    let byBack = false;
    const onPop = () => {
      /* Not the innermost: somebody else's Back. */
      if (stack[stack.length - 1] !== token) return;
      byBack = true;
      /* A dismiss that REFUSED — a sheet with unsaved changes asking
         whether to discard them — keeps the thing open, so it has to keep
         an entry of its own too. Without this, answering "keep editing"
         left the sheet open with nothing in front of it, and the next Back
         walked off the screen underneath. */
      if (dismiss.current() === false) {
        byBack = false;
        window.history.pushState({ ...(window.history.state ?? {}), crmOverlay: true }, "", window.location.href);
      }
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      const at = stack.lastIndexOf(token);
      if (at >= 0) stack.splice(at, 1);
      if (byBack) return;
      pending.current = window.setTimeout(() => {
        pending.current = null;
        /* Only if the entry on top is still ours. It will not be when the
           dialog closed because the whole SCREEN changed under it — and
           going back there would undo the navigation somebody just made. */
        const state = window.history.state as { crmOverlay?: boolean } | null;
        if (state?.crmOverlay) window.history.back();
      }, 0);
    };
  }, [open]);
}
