// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "../../components/Toast";
import { ProfileMailerScreen } from "./ProfileMailerScreen";

/**
 * The number that will be printed under the sender's name, said on the
 * screen BEFORE the mailshot goes.
 *
 * ASKED FOR: "Need agent mobile number in signature when sending company
 * profiles." The signature already printed it where the agent had one on
 * file; where they did not, it printed nothing at all, and nothing on the
 * screen said so. The rule itself is tested in domain/outreach/
 * profileMail.test.ts — these prove the screen tells the truth about it,
 * which is the half that stops the switchboard appearing under somebody's
 * name without their knowing.
 */

vi.mock("../../data/companyProfile", () => ({
  MAX_PROFILE_BYTES: 5_000_000,
  ProfileError: class extends Error {},
  loadProfileFile: async () => null,
  loadProfileInfo: async () => null,
  loadRecentSends: async () => [],
  saveProfile: async () => {},
}));
vi.mock("../../data/outreach", () => ({ suppressedAddresses: async () => new Set() }));

const saved: string[] = [];
vi.mock("../../data/session", () => ({
  setMyDetails: async (patch: { phone?: string }) => { saved.push(patch.phone ?? ""); },
}));

afterEach(() => { cleanup(); saved.length = 0; });

const mount = (phone?: string, companyPhone?: string) => render(
  <ToastProvider>
    <ProfileMailerScreen
      api={{} as never}
      customers={[]}
      settings={{ company: { name: "TechZoid Technologies Private Limited", phone: companyPhone } }}
      user={{ id: "u1", name: "Abhinav Jain", email: "a@b.c", phone, role: "Admin" }}
      companyId="co"
      canManageProfile
    />
  </ToastProvider>,
);

/** The live note beside the box, not the field's hint — both mention the
 *  company number, and only one of them states what will actually print. */
const note = () => document.querySelector(".row-tight .muted.small")?.textContent ?? "";
const box = () => screen.getByPlaceholderText("+91 98100 12345");

describe("the mobile field on the company profile screen", () => {
  it("is there at all, where somebody about to send will see it", () => {
    mount("+91 98100 12345", "011-4567890");
    expect(screen.getByText(/Your mobile, in the signature/)).toBeTruthy();
  });

  it("states the agent's own number when they have one", () => {
    mount("+91 98100 12345", "011-4567890");
    expect(note()).toContain("+91 98100 12345");
    expect(note()).not.toContain("the company number");
    expect(screen.getByText(/tap-to-call/)).toBeTruthy();
  });

  it("SAYS SO when the company number is standing in for theirs", () => {
    /* The whole point. A fallback nobody is told about is how the
       switchboard came to sit under everybody's name. */
    mount("", "011-4567890");
    expect(note()).toContain("011-4567890");
    expect(note()).toContain("the company number");
    expect(screen.getByText(/no mobile of your own set/)).toBeTruthy();
  });

  it("warns in the clear when NO number will be printed", () => {
    mount("", "");
    expect(screen.getByText(/No number will be printed/)).toBeTruthy();
    expect(screen.getByText(/go out with NO number under your name/)).toBeTruthy();
  });

  it("follows the box as it is typed, before anything is saved", () => {
    /* The preview on this screen IS the message, so a number typed and
       not yet saved has to be the number it shows. */
    mount("", "011-4567890");
    expect(note()).toContain("the company number");
    fireEvent.change(box(), { target: { value: "+91 99999 11111" } });
    expect(note()).toContain("+91 99999 11111");
    expect(note()).not.toContain("the company number");
  });

  it("keeps it on their profile when Save is pressed", () => {
    mount("", "011-4567890");
    fireEvent.change(box(), { target: { value: "+91 99999 11111" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(saved).toEqual(["+91 99999 11111"]);
  });

  it("offers nothing to save until it has been changed", () => {
    mount("+91 98100 12345", "011-4567890");
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
