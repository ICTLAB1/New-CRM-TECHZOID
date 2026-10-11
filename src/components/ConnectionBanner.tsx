import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSync, subscribeSync } from "../data/offline";
import { useOnline } from "./useOnline";
import { usePresence } from "./usePresence";

/**
 * "You're offline", and then — briefly — "Connection restored".
 *
 * WHAT IT DELIBERATELY DOES NOT SAY. Coming back online does not mean
 * anything was synchronised. The app reloads its workspace on its own when
 * realtime reconnects, but a banner cannot know that has finished, and
 * "everything is up to date" is a claim a salesperson has no way to check
 * and every reason to trust. So it reports the CONNECTION, which is the only
 * thing it actually knows about.
 *
 * Not a toast, on purpose: being offline is a condition, not an event. It
 * lasts, and it should stay on screen for as long as it is true rather than
 * dismissing itself after four seconds while still being the case.
 */
export function ConnectionBanner() {
  const online = useOnline();
  const sync = useSyncExternalStore(subscribeSync, getSync, getSync);
  const since = sync.syncedAt
    ? new Date(sync.syncedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : null;
  const waiting = sync.pending > 0
    ? ` ${sync.pending} change${sync.pending === 1 ? "" : "s"} saved on this device will upload when you're back online.`
    : " Anything you add or change is saved on this device and uploads by itself when you're back online.";
  const [restored, setRestored] = useState(false);
  /* Nothing on first paint: somebody who was online all along should never
     see "connection restored" for a connection that never dropped. */
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) { wasOffline.current = true; setRestored(false); return; }
    if (!wasOffline.current) return;
    wasOffline.current = false;
    setRestored(true);
    const t = setTimeout(() => setRestored(false), 4000);
    return () => clearTimeout(t);
  }, [online]);

  const show = !online || restored || (online && sync.pending > 0);
  const { mounted, className } = usePresence(show);
  if (!mounted) return null;

  return (
    <div
      className={"page-banner notice " + (online ? "notice-good" : "notice-warn") + className}
      /* A condition, not an interruption: announced when the reader reaches
         a pause rather than cutting across what they are doing. */
      role="status"
      aria-live="polite"
    >
      <span>
        {online && sync.pending > 0 ? (
          <><strong>Uploading changes made offline…</strong> {sync.pending} waiting.</>
        ) : online ? (
          <><strong>Back online.</strong> Everything done offline has been uploaded.</>
        ) : (
          <>
            <strong>You're offline.</strong> Showing data{since ? ` from ${since}` : ""}.{waiting}
            {" "}Sending email or WhatsApp waits for the connection.
          </>
        )}
      </span>
    </div>
  );
}
