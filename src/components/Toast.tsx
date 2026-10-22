import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { EXIT_MS, prefersReducedMotion } from "./usePresence";

/**
 * The one place the app reports an outcome.
 *
 * A toast reports; it never asks a question and never carries the only copy
 * of something the user needs. Anything that needs an answer is a Confirm;
 * anything that must be read later belongs in the record.
 *
 * THERE IS DELIBERATELY ONE OF THESE. A second notification system is how an
 * app ends up with two visual languages for the same event and two places to
 * look when something goes wrong.
 */

export type ToastTone = "good" | "info" | "warn" | "bad";

/**
 * An offer attached to a toast — in practice, Undo.
 *
 * IT IS AN OFFER AND NOT A PROMISE. A toast only ever offers this where the
 * action behind it is genuinely reversible: moving a message back to the
 * folder it came from, restoring a row the server still holds. It must
 * never appear on something that cannot actually be put back, because an
 * Undo that fails is worse than no Undo — the person stopped worrying the
 * moment they saw it.
 */
export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastMessage {
  id: number;
  text: string;
  tone?: ToastTone;
  action?: ToastAction;
}

/**
 * How long each kind stays.
 *
 * Scaled to what the reader has to do about it. A success needs long enough
 * to be noticed and no longer; a failure usually asks them to do something,
 * and taking it away mid-sentence means they have to make the mistake again
 * to read the rest of it.
 */
const LIFE: Record<ToastTone, number> = {
  good: 3800,
  info: 5000,
  warn: 6000,
  bad: 9000,
};

/**
 * A toast carrying an offer stays longer than one that only reports.
 *
 * The toast IS the window — when it goes, the offer goes with it. 3.8
 * seconds is plenty to read "Moved to Deleted Items" and nowhere near
 * enough to notice it, decide it was wrong, and reach the button.
 */
const LIFE_WITH_ACTION = 9000;

interface Api {
  push: (text: string, tone?: ToastTone, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<Api>({ push: () => {}, dismiss: () => {} });

/** `toast("Customer created", "good")` — the shape every call site already
 *  uses, kept exactly as it was. */
export const useToast = () => useContext(ToastContext).push;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMessage[]>([]);
  /* The ones on their way out, kept in the list for the length of the exit
     so they slide away rather than blink out. The dock is the one place in
     the app where things leave on their own, so a missing exit shows most. */
  const [leaving, setLeaving] = useState<number[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>[]>());

  const drop = useCallback((id: number) => {
    for (const t of timers.current.get(id) ?? []) clearTimeout(t);
    timers.current.delete(id);
    setItems((cur) => cur.filter((t) => t.id !== id));
    setLeaving((cur) => cur.filter((x) => x !== id));
  }, []);

  /** Dismissed by hand: still animates, so it does not vanish under the
   *  cursor that just clicked it. */
  const dismiss = useCallback((id: number) => {
    for (const t of timers.current.get(id) ?? []) clearTimeout(t);
    if (prefersReducedMotion()) { drop(id); return; }
    setLeaving((cur) => (cur.includes(id) ? cur : [...cur, id]));
    timers.current.set(id, [setTimeout(() => drop(id), EXIT_MS)]);
  }, [drop]);

  const push = useCallback((text: string, tone: ToastTone = "good", action?: ToastAction) => {
    const id = Date.now() + Math.random();
    setItems((cur) => [...cur, { id, text, tone, action }]);

    /* EACH TOAST IS TIMED ON ITS OWN. They used to be dismissed oldest-first
       off one timer, so three at once meant the third sat there for the sum
       of the other two — long past the moment it was about. */
    const life = action ? LIFE_WITH_ACTION : (LIFE[tone] ?? LIFE.good);
    if (prefersReducedMotion()) {
      timers.current.set(id, [setTimeout(() => drop(id), life)]);
      return;
    }
    timers.current.set(id, [
      setTimeout(() => setLeaving((cur) => [...cur, id]), life),
      setTimeout(() => drop(id), life + EXIT_MS),
    ]);
  }, [drop]);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        TWO DOCKS, FOR TWO KINDS OF URGENCY. A screen reader is told about a
        failure the moment it happens (`alert`, assertive); everything else
        waits for a pause in what it is already reading (`status`, polite).
        Announcing a saved-successfully over somebody mid-sentence is how
        assistive technology gets switched off.
      */}
      <div className="toast-dock">
        <div role="alert" aria-live="assertive" className="toast-stack">
          {items.filter((t) => t.tone === "bad").map((t) => (
            <Toast key={t.id} toast={t} leaving={leaving.includes(t.id)} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
        <div role="status" aria-live="polite" className="toast-stack">
          {items.filter((t) => t.tone !== "bad").map((t) => (
            <Toast key={t.id} toast={t} leaving={leaving.includes(t.id)} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, leaving, onDismiss }: { toast: ToastMessage; leaving: boolean; onDismiss: () => void }) {
  return (
    <div className={"toast" + (toast.tone ? " toast-" + toast.tone : "") + (leaving ? " is-leaving" : "")}>
      <span className="toast-text">{toast.text}</span>
      {toast.action ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => { void toast.action?.run(); onDismiss(); }}
        >
          {toast.action.label}
        </button>
      ) : null}
      {/* How long it has left, drawn as a line that drains. Decoration only. */}
      <span
        className="toast-life"
        aria-hidden
        style={{ animationDuration: `${toast.action ? LIFE_WITH_ACTION : (LIFE[toast.tone ?? "good"] ?? LIFE.good)}ms` }}
      />
      {/* Reachable by keyboard and named for a screen reader, because a
          notification that can only be waited out is one a keyboard user
          cannot get out of the way. */}
      <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={onDismiss}>
        ✕
      </button>
    </div>
  );
}
