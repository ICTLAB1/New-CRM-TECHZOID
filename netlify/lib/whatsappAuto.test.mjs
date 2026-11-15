import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./whatsappSender.mjs", () => ({ sendMessage: vi.fn() }));
const { sendMessage } = await import("./whatsappSender.mjs");
const { notifyOnWhatsApp } = await import("./whatsappAuto.mjs");

const admin = {};
const args = { companyId: "c1", template: "payment_received", recordType: "bill", recordId: "b1" };

beforeEach(() => {
  sendMessage.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("an automatic WhatsApp message", () => {
  it("sends, and says so", async () => {
    sendMessage.mockResolvedValue({ ok: true, id: "wamid.1" });
    await expect(notifyOnWhatsApp(admin, args)).resolves.toMatchObject({ ok: true });
  });

  it("is never manual, so the switch is always consulted", async () => {
    sendMessage.mockResolvedValue({ ok: true });
    await notifyOnWhatsApp(admin, { ...args, manual: true });
    expect(sendMessage.mock.calls[0][1].manual).toBe(false);
  });

  it("swallows a refusal rather than failing what caused it", async () => {
    sendMessage.mockResolvedValue({ ok: false, reason: "That message is switched off." });
    await expect(notifyOnWhatsApp(admin, args)).resolves.toMatchObject({ ok: false });
  });

  it("swallows a crash rather than failing what caused it", async () => {
    sendMessage.mockRejectedValue(new Error("Meta is down"));
    const out = await notifyOnWhatsApp(admin, args);
    expect(out.ok).toBe(false);
    expect(out.reason).not.toContain("Meta is down");
  });

  it("survives a sender that returns nothing at all", async () => {
    sendMessage.mockResolvedValue(undefined);
    await expect(notifyOnWhatsApp(admin, args)).resolves.toMatchObject({ ok: false });
  });

  it("does not complain when the message had already gone today", async () => {
    sendMessage.mockResolvedValue({ ok: false, alreadySent: true, reason: "Already sent today." });
    await notifyOnWhatsApp(admin, args);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("names the record in the log, so a refusal can be traced", async () => {
    sendMessage.mockResolvedValue({ ok: false, reason: "no number" });
    await notifyOnWhatsApp(admin, args);
    expect(String(console.log.mock.calls[0]?.join(" "))).toContain("b1");
  });
});
