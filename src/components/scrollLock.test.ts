import { describe, expect, it } from "vitest";
import { makeScrollLock, type ScrollLockTarget } from "./scrollLock";

/** A stand-in for body.style.overflow. */
function page(initial = "") {
  let value = initial;
  const target: ScrollLockTarget = { get: () => value, set: (v) => { value = v; } };
  return { target, get value() { return value; } };
}

describe("locking the page behind a dialog", () => {
  it("hides while one dialog is open and puts it back after", () => {
    const p = page();
    const lock = makeScrollLock(p.target);
    const release = lock();
    expect(p.value).toBe("hidden");
    release();
    expect(p.value).toBe("");
  });

  it("stays hidden until the last dialog lets go, whichever closes first", () => {
    /* THE REPORTED BUG. Each dialog used to put back the value IT saw, so
       closing the outer one first left the inner one restoring "hidden" —
       an unscrollable page with nothing on screen to explain it. */
    for (const order of [["a", "b"], ["b", "a"]] as const) {
      const p = page();
      const lock = makeScrollLock(p.target);
      const release = { a: lock(), b: lock() };
      expect(p.value).toBe("hidden");

      release[order[0]]();
      expect(p.value, `after ${order[0]} closed, ${order[1]} is still open`).toBe("hidden");

      release[order[1]]();
      expect(p.value, `both closed (${order.join(" then ")})`).toBe("");
    }
  });

  it("restores what the page actually had, not an empty string", () => {
    /* A workspace that sets its own overflow must get its own value back,
       not a guess at what the default was. */
    const p = page("clip");
    const lock = makeScrollLock(p.target);
    const release = lock();
    release();
    expect(p.value).toBe("clip");
  });

  it("counts a release once however many times it is called", () => {
    const p = page();
    const lock = makeScrollLock(p.target);
    const first = lock();
    const second = lock();
    first(); first(); first();
    expect(p.value, "the second dialog is still open").toBe("hidden");
    second();
    expect(p.value).toBe("");
  });

  it("locks again cleanly after everything has closed", () => {
    const p = page();
    const lock = makeScrollLock(p.target);
    lock()();
    const again = lock();
    expect(p.value).toBe("hidden");
    again();
    expect(p.value).toBe("");
  });
});
