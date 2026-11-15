// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useDismissOnBack } from "./useDismissOnBack";

/**
 * Back has to close ONE thing — the innermost — and leave what is under it
 * alone. Every open overlay listens to the same window event, so this is
 * the part that cannot be left to luck.
 */

/**
 * Unmounting an overlay schedules its tidy-up a tick later, and the hook
 * swallows the one popstate that tidy-up causes. Both outlive the test that
 * started them, so each test ends by letting them finish: without this,
 * the previous test's tidy-up swallowed the next test's Back and the
 * failure landed two tests away from its cause.
 *
 * 250ms is the hook's 200ms safety timer plus room to spare.
 */
const settle = () => new Promise((r) => setTimeout(r, 250));

afterEach(async () => {
  cleanup();
  await settle();
});

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

  it("does not let a dialog closing ITSELF close the editor underneath", async () => {
    /* THE BUG THIS PINS. Picking a product in "Add from catalog" closes the
       picker by its own state, not by Back. The picker's tidy-up then walks
       off the history entry it had pushed — and that popstate reached the
       editor underneath, which had just become the innermost overlay. The
       editor closed and the unsaved draft went with it.
       Found in a browser, with a real catalog and a real quotation. */
    const editor = vi.fn();
    const picker = vi.fn();
    const view = render(
      <>
        <Overlay open onDismiss={editor} />
        <Overlay open onDismiss={picker} />
      </>,
    );

    /* Add pressed: the picker closes itself. */
    view.rerender(
      <>
        <Overlay open onDismiss={editor} />
        <Overlay open={false} onDismiss={picker} />
      </>,
    );

    /* The deferred tidy-up runs and calls history.back(), which the browser
       answers with a popstate. jsdom's own navigation is asynchronous and
       would land unpredictably, so back() is stubbed and the event it would
       have produced is dispatched here. */
    const went = vi.spyOn(window.history, "back").mockImplementation(() => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(went).toHaveBeenCalledTimes(1);
    back();

    expect(editor).not.toHaveBeenCalled();
    expect(picker).not.toHaveBeenCalled();
    went.mockRestore();
    await settle();
  });

  it("still gives the editor the NEXT real Back after that", async () => {
    /* The swallow is one popstate, not a mood. */
    const editor = vi.fn();
    const picker = vi.fn();
    const view = render(
      <>
        <Overlay open onDismiss={editor} />
        <Overlay open onDismiss={picker} />
      </>,
    );
    view.rerender(
      <>
        <Overlay open onDismiss={editor} />
        <Overlay open={false} onDismiss={picker} />
      </>,
    );
    const went = vi.spyOn(window.history, "back").mockImplementation(() => {});
    await new Promise((r) => setTimeout(r, 0));
    /* The first popstate is the picker's own tidy-up, swallowed. The second
       is a person pressing Back, and the editor must get it. */
    back();
    back();

    expect(editor).toHaveBeenCalledTimes(1);
    went.mockRestore();
    await settle();
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
