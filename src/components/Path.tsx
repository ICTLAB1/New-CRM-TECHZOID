/**
 * The stage path: where this thing is, and what is left.
 *
 * WHY A ROW OF CHEVRONS AND NOT THE CHIP IT REPLACES. A chip reading
 * "Negotiation" answers where the deal is and nothing else. It does not
 * say what came before, what comes next, or how far along that is — and
 * those are the questions somebody opening a record actually has. The
 * path answers all four in one glance, which is why every sales tool
 * converged on it.
 *
 * It is also a control, not a picture: clicking a step moves the record
 * there. Passing no onPick renders it read-only, which is what the
 * customer header does while stages still belong to deals.
 */

export interface PathStep {
  id: string;
  label: string;
}

export interface PathProps {
  steps: readonly PathStep[];
  /** The step the record is on. An id not in `steps` marks none of them. */
  current: string;
  /** How the CURRENT step reads. A concluded path is not the same news as
   *  one in progress, and a lost deal drawn in the accent colour would say
   *  it was going well. */
  tone?: "accent" | "good" | "bad";
  onPick?: (id: string) => void;
}

export function Path({ steps, current, tone = "accent", onPick }: PathProps) {
  const at = steps.findIndex((s) => s.id === current);
  return (
    <ol className="path" role="list">
      {steps.map((step, i) => {
        /* Everything before the current step is done. Nothing after it is
           assumed — a path that shaded the future would be a forecast. */
        const state = i < at ? "is-done" : i === at ? "is-current is-" + tone : "is-todo";
        const label = (
          <>
            <span className="path-tick" aria-hidden="true">{i < at ? "✓" : ""}</span>
            <span className="path-label">{step.label}</span>
          </>
        );
        return (
          <li className={"path-step " + state} key={step.id} aria-current={i === at ? "step" : undefined}>
            {onPick ? (
              <button type="button" className="path-hit" onClick={() => onPick(step.id)}>{label}</button>
            ) : (
              <span className="path-hit">{label}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
