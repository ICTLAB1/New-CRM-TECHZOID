import { describe, expect, it } from "vitest";
import { foldersInOutlookOrder } from "./folders";
import type { MailFolder } from "../../data/mail";

const f = (name: string, unread = 0, id = name.toLowerCase()): MailFolder =>
  ({ id, name, unread, total: unread });

describe("the folder rail", () => {
  it("is in the order every mail client uses, not alphabetical", () => {
    const got = foldersInOutlookOrder([
      f("Deleted Items"), f("Sent Items"), f("Inbox"), f("Drafts"), f("Archive"),
    ]);
    expect(got.map((x) => x.label)).toEqual(["Inbox", "Drafts", "Sent", "Archive", "Deleted"]);
  });

  it("addresses standard folders by well-known name, not by id", () => {
    /* The display name is localised; the well-known name is not. Using the
       id would work too, but the name keeps the list call readable and is
       what Graph documents. */
    const got = foldersInOutlookOrder([f("Sent Items", 0, "AAA-opaque-id")]);
    expect(got.find((x) => x.label === "Sent")?.key).toBe("sentitems");
  });

  it("shows the Inbox even before the folder list has loaded", () => {
    /* The screen opens on it. An empty rail reads as a mailbox with no
       folders rather than one still loading. */
    expect(foldersInOutlookOrder([]).map((x) => x.label)).toEqual(["Inbox"]);
  });

  it("leaves out standard folders this mailbox does not have", () => {
    const got = foldersInOutlookOrder([f("Inbox"), f("Drafts")]);
    expect(got.map((x) => x.label)).toEqual(["Inbox", "Drafts"]);
  });

  it("puts the person's own folders after the standard ones, alphabetically", () => {
    const got = foldersInOutlookOrder([
      f("Inbox"), f("Zoho imports", 0, "id-z"), f("Customers", 0, "id-c"), f("Sent Items"),
    ]);
    expect(got.map((x) => x.label)).toEqual(["Inbox", "Sent", "Customers", "Zoho imports"]);
  });

  it("addresses a custom folder by its id, because it has no well-known name", () => {
    const got = foldersInOutlookOrder([f("Inbox"), f("Customers", 0, "id-c")]);
    expect(got.find((x) => x.label === "Customers")?.key).toBe("id-c");
  });

  it("carries the unread count through", () => {
    const got = foldersInOutlookOrder([f("Inbox", 7)]);
    expect(got[0]?.unread).toBe(7);
  });
});
