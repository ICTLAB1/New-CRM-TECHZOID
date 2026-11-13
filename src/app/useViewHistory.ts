import { useCallback, useEffect, useState } from "react";
import { HOME, pathForView, viewForPath, viewOnArrival } from "./routes";

/**
 * The browser's own Back button, made to mean something.
 *
 * THE BUG THIS EXISTS FOR. Every screen lived at "/", so Back had no CRM
 * history to walk and left the app — on a phone, where Back is a swipe and
 * the way people close anything, that meant being thrown out of the CRM
 * mid-quotation. Now each screen has an address, moving between them pushes
 * an entry, and Back walks them.
 *
 * AND THERE IS ALWAYS SOMETHING UNDERNEATH. Somebody who opens the CRM on
 * a deep link — from a notification, a bookmark, their own tab from
 * yesterday — has exactly one entry in their history, and Back from it
 * leaves. So on arrival at anything but the dashboard, home is written in
 * underneath first: Back then means the dashboard, which is the promise
 * "back to the last page, or Home".
 *
 * REPLACE, NOT PUSH, FOR THE SCREEN YOU ARE ALREADY ON. Pressing Customers
 * while on Customers — which the sidebar invites, since it is how you clear
 * a filter — must not stack entries that Back then has to walk back
 * through one at a time.
 */
export function useViewHistory(): [string, (next: string) => void] {
  const [view, setView] = useState(() =>
    typeof window === "undefined" ? HOME : viewOnArrival(window.location.pathname));

  /* On arrival only. `history.state` carries the marker, so a reload — which
     replays the same entry — does not write a second home underneath. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const here = viewOnArrival(window.location.pathname);
    const state = window.history.state as { crmView?: string } | null;
    if (state?.crmView) return;
    if (here !== HOME) {
      window.history.replaceState({ crmView: HOME }, "", pathForView(HOME));
      window.history.pushState({ crmView: here }, "", pathForView(here));
    } else {
      window.history.replaceState({ crmView: HOME }, "", pathForView(HOME));
    }
  }, []);

  /* Back and forward. The view is read from the URL rather than from the
     state we stored, so an entry written by anything else — an overlay
     closing itself, a hand-typed address — still resolves to a screen. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => setView(viewOnArrival(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: string) => {
    setView(next);
    if (typeof window === "undefined") return;
    const path = pathForView(next);
    if (viewForPath(window.location.pathname) === viewOnArrival(path)) {
      window.history.replaceState({ crmView: next }, "", path);
    } else {
      window.history.pushState({ crmView: next }, "", path);
    }
  }, []);

  return [view, navigate];
}
