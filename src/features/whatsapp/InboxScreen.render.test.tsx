// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ToastProvider } from "../../components/Toast";
import { InboxScreen } from "./InboxScreen";
import type { WhatsAppMessage } from "../../data/whatsapp";
import type { Customer } from "../../domain/customers/customer";

/**
 * THE INBOX ON A PHONE.
 *
 * REPORTED, with a screenshot from a phone: "There is no chatting option
 * in this." There was — in a second card, below a conversation list 520px
 * tall that scrolled inside itself, which on a phone meant below the
 * bottom of the screen. `.split` is two columns on a desktop and one on a
 * phone, and nothing said which of the two a phone should be looking at.
 *
 * The pane that shows is decided by `data-phone-pane` and the stylesheet,
 * so these assert the attribute and the Back control rather than
 * computed CSS, which jsdom does not evaluate media queries for.
 */

/* Hoisted, because InboxScreen binds `loadRecentMessages` at module load:
   a spy applied afterwards never reaches the binding it already holds.
   Everything else in the module is the real thing — threadsFrom and
   replyWindow are exactly what is under test here. */
const inbox = vi.hoisted(() => ({ messages: [] as unknown[] }));
vi.mock("../../data/whatsapp", async (importActual) => ({
  ...(await importActual<typeof import("../../data/whatsapp")>()),
  loadRecentMessages: async () => inbox.messages,
  replyOnWhatsApp: async () => ({ ok: true }),
}));

const msg = (over: Partial<WhatsAppMessage>): WhatsAppMessage => ({
  id: "m", direction: "out", customerId: null, phone: "919810012345", contactName: "",
  template: "", body: "", status: "sent", error: "", trigger: "", documentName: "",
  at: new Date().toISOString(), ...over,
});

const ago = (mins: number) => new Date(Date.now() - mins * 60000).toISOString();

const WROTE_JUST_NOW = [
  msg({ id: "a", phone: "919810000003", customerId: "c-vk", direction: "in", body: "Hlo", at: ago(12) }),
];

/* A thread the company started: an outbound quotation and no reply ever.
   Three of the five on the live inbox looked like this. */
const WE_WROTE_ONLY = [
  msg({ id: "b", phone: "919810000002", customerId: "c-en", direction: "out", body: "We sent you quotation TZ/QT/2026-27/0137", at: ago(2000) }),
];

const CUSTOMERS = [
  { id: "c-vk", company: "Vikas Ghoghaliya" },
  { id: "c-en", company: "Encalm Hospitality Private Limited" },
] as unknown as Customer[];

const mount = async (messages: WhatsAppMessage[]) => {
  inbox.messages = messages;
  render(
    <ToastProvider>
      <InboxScreen companyId="co" customers={CUSTOMERS} />
    </ToastProvider>,
  );
  await waitFor(() => expect(document.querySelector(".inbox-split")).not.toBeNull());
  return () => document.querySelector(".inbox-split")!;
};

/* The name is in BOTH panes — the list row and the conversation's own
   heading — so a tap has to be aimed at the list or it is ambiguous. */
const tapInList = (name: string | RegExp) =>
  fireEvent.click(within(document.querySelector(".inbox-pane-list") as HTMLElement).getByText(name));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("which pane a phone is showing", () => {
  it("opens on the list of conversations", async () => {
    const split = await mount(WROTE_JUST_NOW);
    expect(split().getAttribute("data-phone-pane")).toBe("list");
  });

  it("shows the conversation once one is tapped", async () => {
    /* THE WHOLE BUG. Tapping a conversation used to change which thread
       the card below displayed — a card the reader could not see. */
    const split = await mount(WROTE_JUST_NOW);
    tapInList("Vikas Ghoghaliya");
    expect(split().getAttribute("data-phone-pane")).toBe("thread");
  });

  it("goes back to the list", async () => {
    const split = await mount(WROTE_JUST_NOW);
    tapInList("Vikas Ghoghaliya");
    fireEvent.click(screen.getByRole("button", { name: /All chats/ }));
    expect(split().getAttribute("data-phone-pane")).toBe("list");
  });

  it("carries a Back control at all, phone-only", async () => {
    /* `.mobile-only` is what hides it on a desktop, where both panes are
       on screen and a Back would go nowhere. */
    await mount(WROTE_JUST_NOW);
    tapInList("Vikas Ghoghaliya");
    expect(screen.getByRole("button", { name: /All chats/ }).className).toContain("mobile-only");
  });
});

describe("what the conversation offers", () => {
  it("gives a reply box when they wrote within the day", async () => {
    await mount(WROTE_JUST_NOW);
    tapInList("Vikas Ghoghaliya");
    expect(screen.getByLabelText("Your reply")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send reply/ })).toBeTruthy();
  });

  it("says they have NOT WRITTEN YET rather than claiming a day has passed", async () => {
    /* The old wording — "More than 24 hours since they wrote" — was said
       about people who had never written, which reads as the CRM having
       lost their messages. */
    await mount(WE_WROTE_ONLY);
    tapInList("Encalm Hospitality Private Limited");
    expect(screen.getByText(/have not written to you on WhatsApp yet/)).toBeTruthy();
    expect(screen.queryByText(/More than 24 hours since they wrote/)).toBeNull();
    /* And no box, because Meta would refuse the message. */
    expect(screen.queryByLabelText("Your reply")).toBeNull();
  });

  it("still says a day has passed when they DID write, a while ago", async () => {
    await mount([msg({ id: "c", phone: "919810000004", direction: "in", body: "Hi", at: ago(60 * 48) })]);
    tapInList("+919810000004");
    expect(screen.getByText(/More than 24 hours since they wrote/)).toBeTruthy();
    expect(screen.queryByLabelText("Your reply")).toBeNull();
  });
});
