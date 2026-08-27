import { useEffect, useState } from "react";

/**
 * Whether the browser thinks it can reach the network.
 *
 * WORTH KNOWING WHAT THIS IS NOT. `navigator.onLine` is false only when the
 * device has no network interface at all; it says nothing about a connection
 * that is up but useless — a hotel portal, a train tunnel, a mobile signal
 * that has dropped to nothing. So this can say "online" when nothing works.
 *
 * That is why the banner it drives makes a claim about connectivity and NOT
 * about data: coming back online does not mean anything was synchronised,
 * and saying it was would be a lie the user cannot check.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}
