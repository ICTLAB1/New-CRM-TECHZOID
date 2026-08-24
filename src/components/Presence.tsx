import { useEffect, useState, type ReactNode } from "react";
import { usePresence } from "./usePresence";

/**
 * Let a dialog that is mounted from a value animate itself away.
 *
 * Most panels here open by holding a record: `{editing ? <Sheet …/> : null}`.
 * The moment that value is cleared React removes the whole subtree, so a
 * panel with a perfectly good exit animation never gets to run it — the
 * component is gone before the first frame.
 *
 * This holds the LAST value through the exit, so the panel keeps rendering
 * the record it was showing while it fades, and reports `open` separately.
 * Nothing downstream needs to know: the dialog takes an `open` prop and
 * passes it to its Modal.
 *
 *   <Presence value={editing}>
 *     {(customer, open) => <CustomerSheet open={open} customer={customer} … />}
 *   </Presence>
 *
 * The held value is deliberately NOT cleared on the way out. Clearing it
 * would blank the panel's contents for the length of the fade, which looks
 * far worse than the fade it was meant to enable.
 */
export function Presence<T>({
  value,
  children,
}: {
  value: T | null | undefined;
  children: (value: T, open: boolean) => ReactNode;
}) {
  const [held, setHeld] = useState<T | null>(value ?? null);
  const { mounted } = usePresence(!!value);

  useEffect(() => {
    if (value) setHeld(value);
  }, [value]);

  if (!mounted || !held) return null;
  return <>{children(held, !!value)}</>;
}
