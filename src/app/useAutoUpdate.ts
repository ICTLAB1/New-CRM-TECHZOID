import { useEffect } from "react";

/**
 * Pick up a new version of the CRM without anybody pressing Ctrl+Shift+R.
 *
 * Every three minutes the page asks the server for index.html and compares
 * the script it names with the one this page is running. A difference means
 * a new deploy, and the page reloads into it.
 *
 * NEVER OVER SOMEBODY'S WORK. A reload throws away whatever is on screen,
 * so it waits for a safe moment: the tab visible, no panel or dialog open
 * (every editor here is one), no field focused, and nothing typed or
 * clicked for a minute. Until then it simply checks again shortly.
 *
 * The DATA is not what this is for — the workspace already refetches every
 * 45 seconds and whenever the tab comes back into view (useWorkspace.ts).
 */
const CHECK_MS = 3 * 60_000;
const RETRY_MS = 30_000;
const QUIET_MS = 60_000;

function runningScript(): string {
  const el = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return el ? new URL(el.src, location.href).pathname : "";
}

async function latestScript(): Promise<string> {
  const res = await fetch("/index.html?v=" + Date.now(), { cache: "no-store" });
  if (!res.ok) return "";
  const html = await res.text();
  const m = /<script[^>]+type="module"[^>]+src="([^"]*\/assets\/[^"]+)"/.exec(html)
    ?? /<script[^>]+src="([^"]*\/assets\/[^"]+)"[^>]*type="module"/.exec(html);
  return m && m[1] ? new URL(m[1], location.href).pathname : "";
}

function safeToReload(lastActivity: number): boolean {
  if (document.visibilityState !== "visible") return false;
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
  const active = document.activeElement as HTMLElement | null;
  if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName))) return false;
  return Date.now() - lastActivity > QUIET_MS;
}

export function useAutoUpdate(enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const current = runningScript();
    if (!current) return; // a dev server: nothing to compare against

    let lastActivity = Date.now();
    const touch = () => { lastActivity = Date.now(); };
    const events = ["pointerdown", "keydown", "input", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));

    let timer: ReturnType<typeof setTimeout>;
    let pending = false;
    const tick = async () => {
      try {
        if (!pending) {
          const latest = await latestScript();
          pending = !!latest && latest !== current;
        }
        if (pending && safeToReload(lastActivity)) {
          window.location.reload();
          return;
        }
      } catch {
        /* Offline or a blip: try again on the next round. */
      }
      timer = setTimeout(tick, pending ? RETRY_MS : CHECK_MS);
    };
    timer = setTimeout(tick, CHECK_MS);

    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [enabled]);
}
