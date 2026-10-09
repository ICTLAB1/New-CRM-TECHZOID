/**
 * Loading states that look like what is coming, rather than a sentence.
 * The shimmer and the progress travel are in styles/motion.css, and both
 * stop for anyone who has asked their system for reduced motion.
 */

/** The shape of the CRM while the workspace loads: sidebar, title, figures, cards. */
export function WorkspaceSkeleton({ label = "Loading your workspace…" }: { label?: string }) {
  return (
    <div className="skel-shell" role="status" aria-live="polite" aria-label={label}>
      <aside className="skel-side" aria-hidden>
        <div className="skel" style={{ height: 28, width: "60%", marginBottom: 14 }} />
        {Array.from({ length: 11 }, (_, i) => (
          <div key={i} className="skel" style={{ height: 14, width: `${60 + ((i * 17) % 30)}%` }} />
        ))}
      </aside>
      <main className="skel-main" aria-hidden>
        <div className="skel" style={{ height: 26, width: 260 }} />
        <div className="skel" style={{ height: 14, width: 180 }} />
        <div className="skel-row">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="skel" style={{ height: 86 }} />)}
        </div>
        <div className="skel-row" style={{ gridTemplateColumns: "2fr 1fr" }}>
          <div className="skel" style={{ height: 260 }} />
          <div className="skel" style={{ height: 260 }} />
        </div>
      </main>
    </div>
  );
}

/** A thin bar across the top of the screen while a save is in flight. */
export function TopProgress({ active }: { active: boolean }) {
  return <div className={"top-progress" + (active ? " is-on" : "")} aria-hidden />;
}
