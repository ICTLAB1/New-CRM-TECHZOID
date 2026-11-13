// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useDismissOnBack } from "./useDismissOnBack";

/**
 * Back has to close ONE thing — the innermost — and leave what is under it
 * alone. Every open overlay listens to the same window event, so this is
 * the part that cannot be left to luck.
 */

afterEach(cleanup);

function Overlay({ open, onDismiss }: { open: boolean; onDismiss: () => boolean | void }) {
  useDismissOnBack(open, onDismiss);
  return null;
}

const back = () => window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));

describe("Back, with things open", () => {
  it("closes the one thing that is open", () => {
    const close = vi.fn();
    render(<Overlay open onDismiss={close} />);

    back();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes only the innermost, and leaves the screen under it alone", () => {
    /* THE BUG THIS PINS. A dialog opened from inside the document editor
       had both of them answer the same Back: the dialog closed, and the
       editor underneath closed with it — so somebody dismissing a send
       dialog lost the quotation they were reading. */
    const editor = vi.fn();
    const dialog = vi.fn();
    render(
      <>
        <Overlay open onDismiss={editor} />
        <Overlay open onDismiss={dialog} />
      </>,
    );

    back();

    expect(dialog).toHaveBeenCalledTimes(1);
    expect(editor).not.toHaveBeenCalled();
  });

  it("hands the next Back to what is underneath once the top one has gone", () => {
    const editor = vi.fn();
    const dialog = vi.fn();
    const view = render(
      <>
        <Overlay open onDismiss={editor} />
        <Overlay open onDismiss={dialog} />
      </>,
    );

    back();
    /* The dialog's own state closes it, which is what its onDismiss does in
       the real screens. */
    view.rerender(
      <>
        <Overlay open onDismiss={editor} />
        <Overlay open={false} onDismiss={dialog} />
      </>,
    );
    back();

    expect(editor).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all while nothing is open", () => {
    const close = vi.fn();
    render(<Overlay open={false} onDismiss={close} />);

    back();

    expect(close).not.toHaveBeenCalled();
  });

  it("keeps an entry for something that refused to close", () => {
    /* A sheet with unsaved changes answers Back by ASKING. It is still
       open, so it still needs an entry in front of it — otherwise the next
       Back walks off the screen underneath. */
    const pushes = vi.spyOn(window.history, "pushState");
    const before = pushes.mock.calls.length;
    render(<Overlay open onDismiss={() => false} />);

    back();
    back();

    /* One on opening, then one after each refusal. */
    expect(pushes.mock.calls.length - before).toBe(3);
    pushes.mockRestore();
  });
});
