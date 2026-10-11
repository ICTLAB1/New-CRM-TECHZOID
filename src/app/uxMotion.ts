/**
 * App-wide interaction motion that no single component owns.
 *
 *   RIPPLE   A soft ring spreads from where a button was pressed. Added by
 *            one delegated listener, so every button in the CRM — existing
 *            and future — gets it without being touched.
 *
 *   REVEAL   Cards and tiles that start below the fold rise into place as
 *            they are scrolled to, instead of having already finished
 *            animating where nobody could see. Safe by construction: an
 *            element is only ever hidden while it is off-screen and being
 *            watched; anything on screen, or any browser without
 *            IntersectionObserver, simply shows.
 *
 * Both are skipped entirely for anyone who asks the system for reduced
 * motion.
 */

const RIPPLE_TARGETS = ".btn, .pt-lane, button.tile, .app-more-item, .launcher-item, .pt-term";
const REVEAL_TARGETS = ".card, .pt-health, .pt-scan-drop, .summary, .tile:not(.summary .tile)";

let installed = false;

export function installUxMotion(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  installRipple();
  installReveal();
}

function installRipple(): void {
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const target = (e.target as Element | null)?.closest?.(RIPPLE_TARGETS) as HTMLElement | null;
    if (!target || target.matches(":disabled, [aria-disabled='true']")) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    const ink = document.createElement("span");
    ink.className = "ux-ripple";
    ink.style.width = ink.style.height = `${size}px`;
    ink.style.left = `${e.clientX - rect.left - size / 2}px`;
    ink.style.top = `${e.clientY - rect.top - size / 2}px`;
    target.classList.add("ux-ripple-host");
    target.appendChild(ink);
    const done = () => ink.remove();
    ink.addEventListener("animationend", done, { once: true });
    window.setTimeout(done, 900);
  }, { passive: true });
}

function installReveal(): void {
  if (!("IntersectionObserver" in window) || !("MutationObserver" in window)) return;

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target as HTMLElement;
      io.unobserve(el);
      el.classList.remove("ux-reveal-wait");
      el.classList.add("ux-reveal-in");
      el.addEventListener("animationend", () => el.classList.remove("ux-reveal-in"), { once: true });
    }
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });

  const seen = new WeakSet<Element>();
  const consider = (el: Element) => {
    if (seen.has(el)) return;
    seen.add(el);
    /* Inside a dialog or drawer: those have their own entrance. */
    if (el.closest(".modal, .launcher, .app-more-menu, .toast-dock")) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.96 || rect.height === 0) return;
    el.classList.add("ux-reveal-wait");
    io.observe(el);
  };

  const scan = (root: ParentNode) => {
    root.querySelectorAll(REVEAL_TARGETS).forEach(consider);
  };

  let queued = false;
  const mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(document); });
  });
  mo.observe(document.body, { childList: true, subtree: true });
  scan(document);

  /* Belt and braces: nothing stays hidden if the observer is ever starved
     (a background tab, a print, a screenshot tool). */
  window.addEventListener("beforeprint", () => {
    document.querySelectorAll(".ux-reveal-wait").forEach((el) => el.classList.remove("ux-reveal-wait"));
  });
}
