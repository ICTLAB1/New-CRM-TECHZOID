import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./primitives";

/**
 * The last thing between a crash and a white screen.
 *
 * React unmounts the whole tree when a render throws. Without a boundary
 * that is a blank page — no navigation, no message, nothing to press — and
 * the salesperson's only move is to close the tab and lose whatever they
 * were typing. This turns it into a sentence and a way back.
 *
 * IT DOES NOT SHOW THE ERROR. The message a component threw is written for
 * whoever wrote the component; it can name internal structure, and this is a
 * screen somebody might photograph in front of a customer. The console gets
 * everything; the page gets a sentence.
 *
 * Class component because there is still no hook for this — `componentDidCatch`
 * and `getDerivedStateFromError` have no function-component equivalent.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; where?: string },
  { crashed: boolean }
> {
  override state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`crash in ${this.props.where ?? "the app"}:`, error, info.componentStack);
  }

  override render() {
    if (!this.state.crashed) return this.props.children;

    return (
      <main className="page">
        <div className="card" style={{ maxWidth: 520, margin: "10vh auto", padding: "var(--gap-wide)" }}>
          <div className="card-title">Something went wrong</div>
          <p className="field-hint" style={{ marginTop: 8 }}>
            We couldn't display this screen. Nothing you had already saved is affected.
          </p>
          <div className="row-tight" style={{ marginTop: 16 }}>
            {/* Reloading is the honest fix: the tree that threw cannot be
                trusted to re-render into a good state, and pretending
                otherwise gives somebody a screen that fails again silently. */}
            <Button tone="primary" onClick={() => window.location.reload()}>Reload the page</Button>
          </div>
        </div>
      </main>
    );
  }
}
