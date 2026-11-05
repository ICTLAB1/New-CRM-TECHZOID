import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SaveFlowOverlay } from "./SaveFlow";

/**
 * The save flow replaced the "saved" toast, so it inherits the toast's job:
 * telling somebody who cannot see the screen that the document was filed,
 * and under what number.
 */

const html = (state: Parameters<typeof SaveFlowOverlay>[0]["state"]) =>
  renderToStaticMarkup(<SaveFlowOverlay state={state} onDismiss={() => {}} />);

describe("the save flow", () => {
  it("shows nothing at rest", () => {
    expect(html({ phase: "idle" })).toBe("");
  });

  it("announces the result, because it is what the toast used to do", () => {
    const out = html({ phase: "done", title: "Quotation saved", number: "TZ/QT/2026-27/0042" });
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("Quotation saved");
    expect(out).toContain("TZ/QT/2026-27/0042");
  });

  it("carries the number the database allocated", () => {
    /* The point of waiting at all: a new document's provisional number is
       not the one it keeps. */
    expect(html({ phase: "done", title: "Saved", number: "TZ/INV/2026-27/0113" }))
      .toContain("TZ/INV/2026-27/0113");
  });

  it("does not claim success while the work is still running", () => {
    /* A tick on screen before the round trip returns would be a lie about
       a number that has not been allocated yet. */
    const out = html({ phase: "working", label: "Filing quotation…" });
    expect(out).toContain("Filing quotation…");
    expect(out).not.toContain("saveflow-check");
    expect(out).toContain("saveflow-ring");
  });

  it("lets the page behind it be used once the work is done", () => {
    /* The confirmation is a notice, not a dialog. Blocking the pointer
       after the save has landed would make an animation the slowest part
       of filing a document. */
    expect(html({ phase: "done", title: "Saved" })).toContain("pointer-events:none");
    expect(html({ phase: "working", label: "…" })).toContain("pointer-events:auto");
  });
});
