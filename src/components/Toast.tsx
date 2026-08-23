import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

  useEffect(() => {
    if (!items.length) return;
    /* Failures stay longer: they usually tell the user to do something. */
    const oldest = items[0]!;
    const life = oldest.tone === "bad" ? 7000 : 3800;
    const timer = setTimeout(() => setItems((cur) => cur.slice(1)), life);
    return () => clearTimeout(timer);
  }, [items]);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-dock" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={"toast" + (t.tone ? " toast-" + t.tone : "")}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
