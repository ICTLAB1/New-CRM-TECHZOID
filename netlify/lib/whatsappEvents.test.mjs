import { describe, expect, it } from "vitest";
import { describeIncoming, nextStatus, parseWebhook, whenOf } from "./whatsappEvents.mjs";

/** A real-shaped envelope, trimmed to the parts that matter. */
const envelope = (value) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: { messaging_product: "whatsapp", ...value } }] }],
});

describe("a customer's reply", () => {
  it("is read out of the envelope with everything needed to file it", () => {
    const { messages } = parseWebhook(envelope({
      contacts: [{ wa_id: "919810012345", profile: { name: "Ravi Sharma" } }],
      messages: [{
        from: "919810012345", id: "wamid.IN1", timestamp: "1763222400",
        type: "text", text: { body: "Yes, please go ahead" },
      }],
    }));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      waMessageId: "wamid.IN1",
      from: "919810012345",
      name: "Ravi Sharma",
      body: "Yes, please go ahead",
    });
    expect(messages[0].at).toMatch(/^2025-|^2026-/);
  });

  it("keeps a reply from somebody with no profile name", () => {
    const { messages } = parseWebhook(envelope({
      messages: [{ from: "919899999999", id: "wamid.X", type: "text", text: { body: "hi" } }],
    }));
    expect(messages[0].name).toBe("");
    expect(messages[0].body).toBe("hi");
  });

  it("NEVER DROPS A MESSAGE just because it is not text", () => {
    /* The business number is API-only, so a message this endpoint drops
       reaches nobody at all. A customer sending their purchase order as a
       PDF must appear in the inbox. */
    const kinds = [
      [{ type: "image", image: { caption: "Our PO" } }, "[a image] Our PO"],
      [{ type: "document", document: { filename: "PO-4471.pdf" } }, "[a document: PO-4471.pdf]"],
      [{ type: "voice", voice: {} }, "[a voice note]"],
      [{ type: "location", location: { name: "Pearl Business Park" } }, "[location: Pearl Business Park]"],
      [{ type: "contacts", contacts: [{}] }, "[a contact card]"],
      [{ type: "unsupported" }, "[a message WhatsApp could not show]"],
      [{ type: "reaction", reaction: { emoji: "👍" } }, "Reacted 👍"],
      [{ type: "button", button: { text: "Stop updates" } }, "Stop updates"],
      [{ type: "interactive", interactive: { button_reply: { title: "Yes" } } }, "Yes"],
    ];
    for (const [message, expected] of kinds) {
      expect(describeIncoming(message)).toBe(expected);
    }
  });

  it("notes which of our messages they were replying to", () => {
    const { messages } = parseWebhook(envelope({
      messages: [{
        from: "919810012345", id: "wamid.IN2", type: "text", text: { body: "ok" },
        context: { id: "wamid.OUT7" },
      }],
    }));
    expect(messages[0].repliesTo).toBe("wamid.OUT7");
  });

  it("reads several in one delivery, which is how a batch arrives", () => {
    const { messages } = parseWebhook(envelope({
      messages: [
        { from: "919810012345", id: "a", type: "text", text: { body: "one" } },
        { from: "919811122333", id: "b", type: "text", text: { body: "two" } },
      ],
    }));
    expect(messages.map((m) => m.body)).toEqual(["one", "two"]);
  });
});

describe("a delivery report", () => {
  it("is read with its message id and its new state", () => {
    const { statuses } = parseWebhook(envelope({
      statuses: [{ id: "wamid.OUT1", status: "delivered", timestamp: "1763222400", recipient_id: "919810012345" }],
    }));
    expect(statuses[0]).toMatchObject({
      waMessageId: "wamid.OUT1", status: "delivered", recipient: "919810012345", error: "",
    });
  });

  it("carries the reason when it failed", () => {
    const { statuses } = parseWebhook(envelope({
      statuses: [{
        id: "wamid.OUT2", status: "failed",
        errors: [{ code: 131026, title: "Message undeliverable" }],
      }],
    }));
    expect(statuses[0].status).toBe("failed");
    expect(statuses[0].error).toBe("Message undeliverable");
  });

  it("comes through alongside messages in the same delivery", () => {
    const { messages, statuses } = parseWebhook(envelope({
      messages: [{ from: "919810012345", id: "in", type: "text", text: { body: "hi" } }],
      statuses: [{ id: "out", status: "read" }],
    }));
    expect(messages).toHaveLength(1);
    expect(statuses).toHaveLength(1);
  });
});

describe("statuses that arrive out of order", () => {
  it("moves forward through sent, delivered and read", () => {
    expect(nextStatus("queued", "sent")).toBe("sent");
    expect(nextStatus("sent", "delivered")).toBe("delivered");
    expect(nextStatus("delivered", "read")).toBe("read");
  });

  it("NEVER WALKS BACKWARDS", () => {
    /* Meta does not promise an order and retries old events. A message the
       customer has read must not show as merely delivered because a
       duplicate turned up an hour later. */
    expect(nextStatus("read", "delivered")).toBe("read");
    expect(nextStatus("read", "sent")).toBe("read");
    expect(nextStatus("delivered", "sent")).toBe("delivered");
  });

  it("lets a failure through whatever came before it", () => {
    expect(nextStatus("sent", "failed")).toBe("failed");
    expect(nextStatus("delivered", "failed")).toBe("failed");
  });

  it("does not let a stray 'sent' undo a failure", () => {
    expect(nextStatus("failed", "sent")).toBe("failed");
    expect(nextStatus("failed", "delivered")).toBe("failed");
  });

  it("ignores a status it does not recognise rather than storing it", () => {
    expect(nextStatus("delivered", "warped")).toBe("delivered");
    expect(nextStatus("", "")).toBe("queued");
  });
});

describe("the envelope itself", () => {
  it("ignores changes that are not about messages", () => {
    /* Template approvals and quality ratings arrive on the same hook. */
    const payload = {
      entry: [{ changes: [
        { field: "message_template_status_update", value: { event: "APPROVED" } },
        { field: "messages", value: { messages: [{ from: "919810012345", id: "x", type: "text", text: { body: "hi" } }] } },
      ] }],
    };
    const { messages } = parseWebhook(payload);
    expect(messages).toHaveLength(1);
  });

  it("survives every shape of rubbish without throwing", () => {
    for (const bad of [null, undefined, {}, { entry: null }, { entry: [{}] },
      { entry: [{ changes: [{ value: null }] }] }, "not an object", 42]) {
      expect(() => parseWebhook(bad)).not.toThrow();
      expect(parseWebhook(bad)).toEqual({ messages: [], statuses: [] });
    }
  });

  it("drops a message with no sender and a status with no id", () => {
    const { messages, statuses } = parseWebhook(envelope({
      messages: [{ id: "x", type: "text", text: { body: "from nobody" } }],
      statuses: [{ status: "read" }],
    }));
    expect(messages).toEqual([]);
    expect(statuses).toEqual([]);
  });
});

describe("the timestamp", () => {
  it("reads Meta's seconds as a real time", () => {
    expect(whenOf("1763222400")).toBe(new Date(1763222400000).toISOString());
  });

  it("falls back to now rather than to 1970", () => {
    for (const bad of ["", null, "nonsense", 0, -5]) {
      expect(new Date(whenOf(bad)).getFullYear()).toBeGreaterThan(2020);
    }
  });
});
