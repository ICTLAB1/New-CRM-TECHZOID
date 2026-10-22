import { describe, expect, it } from "vitest";
import { activeView, isDefaultView, matchesCurrent, readViews, removeView, saveView } from "./savedViews";

const view = (name: string, filters: Record<string, string>) => ({ id: name, name, filters });

describe("saved views", () => {
  it("treats a filter at its default as a filter nobody set", () => {
    /* "all" is what every one of these screens calls no filter. A view
       saved as {status:"all"} and one saved as {} are the same view. */
    expect(matchesCurrent(view("A", { status: "all" }), {})).toBe(true);
    expect(matchesCurrent(view("A", {}), { status: "all", owner: "" })).toBe(true);
  });

  it("does not match when a filter genuinely differs", () => {
    expect(matchesCurrent(view("A", { status: "Sent" }), { status: "Draft" })).toBe(false);
    expect(matchesCurrent(view("A", { status: "Sent" }), {})).toBe(false);
  });

  it("finds which saved view the screen is showing", () => {
    const views = [view("Open", { status: "Sent" }), view("Mine", { owner: "u1" })];
    expect(activeView(views, { status: "Sent", owner: "all" })?.name).toBe("Open");
    expect(activeView(views, { status: "Draft" })).toBeNull();
  });

  it("knows when there is nothing worth saving", () => {
    expect(isDefaultView({ status: "all", owner: "all", query: "" })).toBe(true);
    expect(isDefaultView({ status: "Sent" })).toBe(false);
  });

  it("replaces a view of the same name instead of making a twin", () => {
    /* Two entries with one name behave differently and look identical,
       which is the worst pair of properties a list item can have. */
    const once = saveView([], "Open", { status: "Sent" });
    const twice = saveView(once, "open", { status: "Draft" });
    expect(twice).toHaveLength(1);
    expect(twice[0]?.filters).toEqual({ status: "Draft" });
    expect(twice[0]?.id).toBe(once[0]?.id);
  });

  it("stores only the filters that mean something", () => {
    const [saved] = saveView([], "Open", { status: "Sent", owner: "all", query: "" });
    expect(saved?.filters).toEqual({ status: "Sent" });
  });

  it("refuses a nameless view rather than saving an unclickable blank", () => {
    expect(saveView([], "   ", { status: "Sent" })).toEqual([]);
  });

  it("removes by id", () => {
    const views = [view("A", {}), view("B", {})];
    expect(removeView(views, "A").map((v) => v.name)).toEqual(["B"]);
  });

  describe("a screen whose resting state is not \"all\"", () => {
    /* The payment tracker opens on pending bills. Without declaring that,
       its untouched list reads as filtered: Save on offer forever for the
       screen exactly as it opens. */
    const pending = { view: "open" };

    it("counts the declared default as no filter", () => {
      expect(isDefaultView({ view: "open", query: "" }, pending)).toBe(true);
      expect(isDefaultView({ view: "open" })).toBe(false);
    });

    it("still counts a real filter as one", () => {
      expect(isDefaultView({ view: "paid" }, pending)).toBe(false);
      expect(isDefaultView({ view: "open", query: "acme" }, pending)).toBe(false);
    });

    it("keeps \"all\" meaningful where the default is narrower", () => {
      /* Every bill including the paid ones is a move away from the default,
         not towards it, so it is worth saving and worth matching. */
      expect(isDefaultView({ view: "all" }, pending)).toBe(false);
      expect(matchesCurrent(view("Everything", { view: "all" }), { view: "open" }, pending)).toBe(false);
      expect(matchesCurrent(view("Everything", { view: "all" }), { view: "all" }, pending)).toBe(true);
    });

    it("saves and matches the view the screen opens on nothing", () => {
      const saved = saveView([], "Paid only", { view: "paid", lane: "all", query: "" }, pending);
      expect(saved[0]?.filters).toEqual({ view: "paid" });
      expect(activeView(saved, { view: "paid", lane: "all", query: "" }, pending)?.name).toBe("Paid only");
      expect(activeView(saved, { view: "open", lane: "all", query: "" }, pending)).toBe(null);
    });
  });

  it("survives whatever is actually in localStorage", () => {
    /* It is a string in a browser store: an old version wrote it, a person
       may have edited it, and a crash here takes the whole screen down. */
    expect(readViews(null)).toEqual([]);
    expect(readViews("nonsense")).toEqual([]);
    expect(readViews([{ nope: 1 }, null, 7])).toEqual([]);
    expect(readViews([{ id: "a", name: "A", filters: { status: "Sent" } }])).toHaveLength(1);
  });
});
