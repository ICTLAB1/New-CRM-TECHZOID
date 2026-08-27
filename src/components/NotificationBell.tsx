import { useEffect, useRef, useState } from "react";
import { useToast } from "./Toast";
import { usePresence } from "./usePresence";
import type { CrmEvent } from "../domain/notifications/events";

/**
 * What has happened in the workspace while you were looking at it.
 *
 * FED BY THE EXISTING REALTIME SUBSCRIPTION, not a second one. Events are
 * derived from the refetch that subscription already triggers, which means
 * the whole thing inherits RLS for free: the diff has only rows this person
 * was allowed to load, so no event can name a customer they cannot see.
 * There is nothing here to get the permissions wrong in.
 *
 * TWO WEIGHTS OF NEWS. A quotation somebody else raised belongs in the list;
 * a customer assigned to you, or one of yours marked Won, interrupts with a
 * toast. Everything interrupting is also in the list, so nothing is only
 * visible for four seconds.
 */
export function NotificationBell({ events, onOpen }: { events: CrmEvent[]; onOpen: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string[]>([]);
  const announced = useRef(new Set<string>());
  const box = useRef<HTMLDivElement>(null);

  /* Toast the loud ones, once each. The guard is a ref rather than state
     because re-announcing on a re-render is exactly the failure this exists
     to avoid, and state would make that a race. */
  useEffect(() => {
    for (const e of events) {
      if (!e.loud || announced.current.has(e.id)) continue;
      announced.current.add(e.id);
      toast(e.text, "info");
    }
  }, [events, toast]);

  /* Click outside and Escape both close it: a panel that only closes by
     pressing the thing that opened it is one people leave open. */
  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unreadIds = events.filter((e) => !seen.includes(e.id)).map((e) => e.id);
  const { mounted, className } = usePresence(open);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    /* Opening it is reading it. */
    if (next) { setSeen(events.map((e) => e.id)); onOpen(); }
  };

  return (
    <div className="bell-wrap" ref={box}>
      <button
        type="button"
        className={"bell" + (unreadIds.length ? " has-unread" : "")}
        aria-label={unreadIds.length ? `Notifications, ${unreadIds.length} unread` : "Notifications"}
        aria-expanded={open}
        onClick={toggle}
      >
        <span aria-hidden="true">🔔</span>
        {unreadIds.length ? <span className="bell-count" aria-hidden="true">{unreadIds.length > 9 ? "9+" : unreadIds.length}</span> : null}
      </button>

      {mounted ? (
        <div className={"bell-panel" + className} role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <span className="eyebrow">Notifications</span>
          </div>
          {events.length === 0 ? (
            <p className="field-hint bell-empty">
              Nothing yet. Changes made by anyone else in the CRM appear here as they happen.
            </p>
          ) : (
            <ul className="bell-list">
              {events.map((e) => (
                <li key={e.id} className={"bell-item" + (unreadIds.includes(e.id) ? " is-unread" : "")}>
                  <span className="bell-text">{e.text}</span>
                  <span className="bell-when">{when(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Relative, because "3 minutes ago" is what somebody wants from a list of
 *  things that just happened — a clock time would need working out. */
function when(at: number, now: number = Date.now()): string {
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
