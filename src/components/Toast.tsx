import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { EXIT_MS, prefersReducedMotion } from "./usePresence";

/** A toast reports an outcome. It never asks a question and never carries
 *  the only copy of something the user needs. */
export interface ToastMessage {
  id: number;
  text: string;
  tone?: "good" | "warn" | "bad";
}

const ToastContext = createContext<(text: string, tone?: ToastMessage["tone"]) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMessage[]>([]);

  const push = useCallback((text: string, tone?: ToastMessage["tone"]) => {
    setItems((cur) => [...cur, { id: Date.now() + Math.random(), text, tone }]);
  }, []);

  /* The toast on its way out. Kept in the list for the length of its exit
     so it can slide away rather than blink out — the dock is the one place
     in the app where things disappear on their own, so it is the place a
     missing exit is most obvious. */
  const [leaving, setLeaving] = useState<number | null>(null);

  useEffect(() => {
    if (!items.length) return;
    /* Failures stay longer: they usually tell the user to do something. */
    const oldest = items[0]!;
    const life = oldest.tone === "bad" ? 7000 : 3800;
    const drop = () => setItems((cur) => cur.filter((t) => t.id !== oldest.id));

    if (prefersReducedMotion()) {
      const t = setTimeout(drop, life);
      return () => clearTimeout(t);
    }

    const start = setTimeout(() => setLeaving(oldest.id), life);
    const end = setTimeout(() => {
      setLeaving((cur) => (cur === oldest.id ? null : cur));
      drop();
    }, life + EXIT_MS);
    return () => { clearTimeout(start); clearTimeout(end); };
  }, [items]);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-dock" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={"toast" + (t.tone ? " toast-" + t.tone : "") + (leaving === t.id ? " is-leaving" : "")}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
