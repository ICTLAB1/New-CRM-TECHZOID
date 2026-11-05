import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";
import { Button } from "./primitives";
import { confirm, DUR, EASE, ease } from "./motion";

/**
 * What a document does while it is being filed, and what it says when it is.
 *
 * THE PROGRESS IS REAL. Saving a quotation is a round trip: the number is
 * allocated by the database, not by the browser, precisely so two people
 * cannot take the same one. That round trip is what the ring is waiting
 * for. It is indeterminate because the duration genuinely is — a ring that
 * filled to 80% on a timer would be telling the person something nobody
 * knows.
 *
 * AND IT NEVER HOLDS ANYTHING UP. The save starts first and this watches
 * it; the editor closes when the save lands, not when the animation ends.
 * The confirmation that follows is a card that dismisses itself, not a
 * dialog waiting to be clicked through — the work is already done and the
 * person is already looking at the next thing.
 *
 * IT REPLACES THE "SAVED" TOAST rather than joining it. Two confirmations
 * of one event is how people learn to ignore both. It keeps the toast's
 * role="status" so a screen reader still hears exactly what happened.
 */

export type SaveFlowState =
  | { phase: "idle" }
  | { phase: "working"; label: string }
  | {
      phase: "done";
      title: string;
      /** The number the database allocated, which is the point of waiting. */
      number?: string;
      action?: { label: string; run: () => void };
    };

/** How long the confirmation stays. Long enough to read a document number,
 *  short enough that nobody waits for it. */
const HOLD_MS = 2600;

export function SaveFlowOverlay({ state, onDismiss }: {
  state: SaveFlowState;
  onDismiss: () => void;
}) {
  const done = state.phase === "done";

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onDismiss, HOLD_MS);
    return () => clearTimeout(t);
  }, [done, onDismiss]);

  return (
    <AnimatePresence>
      {state.phase === "idle" ? null : (
        <motion.div
          className="saveflow"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: DUR.exit, ease: EASE } }}
          transition={ease}
          /* Only the working state takes the pointer: once it is done the
             card is a notice, and clicking the page behind it must work. */
          style={{ pointerEvents: state.phase === "working" ? "auto" : "none" }}
        >
          <motion.div
            className="saveflow-card"
            role="status"
            aria-live="polite"
            layout
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: DUR.exit, ease: EASE } }}
            transition={ease}
            style={{ pointerEvents: "auto" }}
          >
            <AnimatePresence mode="wait" initial={false}>
              {state.phase === "working" ? (
                <motion.div
                  key="working"
                  className="saveflow-body"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                >
                  <span className="saveflow-ring" aria-hidden />
                  <div>
                    <div className="saveflow-title">{state.label}</div>
                    {/* The document taking shape: three rules that stagger
                        in and keep going while the round trip does. Plain
                        shapes, not a spinning icon. */}
                    <div className="saveflow-lines" aria-hidden>
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          initial={{ scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{
                            duration: 0.5, ease: EASE, delay: i * 0.12,
                            repeat: Infinity, repeatType: "reverse", repeatDelay: 0.35,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="done"
                  className="saveflow-body"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={ease}
                >
                  <motion.span
                    className="saveflow-check"
                    variants={confirm}
                    initial="initial"
                    animate="animate"
                    aria-hidden
                  >
                    <Check size={18} strokeWidth={3} />
                  </motion.span>
                  <div>
                    <div className="saveflow-title">{state.title}</div>
                    {state.number ? (
                      <motion.div
                        className="saveflow-number mono"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: DUR.enter, ease: EASE, delay: 0.1 }}
                      >
                        {state.number}
                      </motion.div>
                    ) : null}
                  </div>
                  {state.action ? (
                    <motion.span
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: DUR.enter, ease: EASE, delay: 0.16 }}
                    >
                      <Button
                        size="sm"
                        tone="default"
                        onClick={() => { state.action?.run(); onDismiss(); }}
                      >
                        {state.action.label}
                      </Button>
                    </motion.span>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
