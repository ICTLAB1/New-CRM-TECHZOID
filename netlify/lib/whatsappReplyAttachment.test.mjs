import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./whatsappMeta.mjs", async (orig) => {
  const real = await orig();
  return {
    ...real,
    metaAccount: () => ({ token: "t", wabaId: "w", phoneNumberId: "p" }),
    uploadMedia: vi.fn(async () => ({ ok: true, id: "media-9" })),
    sendMedia: vi.fn(async () => ({ ok: true, id: "wamid.media", to: "919810012345" })),
    sendText: vi.fn(async () => ({ ok: true, id: "wamid.text", to: "919810012345" })),
  };
});

const { uploadMedia, sendMedia, sendText } = await import("./whatsappMeta.mjs");
const { replyInWords } = await import("./whatsappSender.mjs");

/**
 * Answering a customer with a file attached.
 *
 * THE TYPED WORDS RIDE AS THE CAPTION, so one message carries both — what
 * a person sending this from their own phone would send. Two messages
 * could arrive out of order, and a file whose explanation failed to send
 * is worse than neither.
 */

/* A stand-in for the one table this path writes. */
let rows = [];
const admin = {
  from: () => ({
    insert: async (row) => { rows.push(row); return { error: null }; },
  }),
};

const FILE = {
  bytes: Buffer.from("not really a pdf"),
  filename: "Price list.pdf",
  kind: "document",
  mimeType: "application/pdf",
};

const reply = (over = {}) => replyInWords(admin, {
  companyId: "co", customerId: "cust", phone: "919810012345", body: "Here you go", sentBy: "u1", ...over,
});

beforeEach(() => {
  rows = [];
  uploadMedia.mockClear();
  sendMedia.mockClear();
  sendText.mockClear();
  uploadMedia.mockResolvedValue({ ok: true, id: "media-9" });
  sendMedia.mockResolvedValue({ ok: true, id: "wamid.media", to: "919810012345" });
  sendText.mockResolvedValue({ ok: true, id: "wamid.text", to: "919810012345" });
});

describe("a reply with nothing attached", () => {
  it("still goes as plain text, exactly as it always did", async () => {
    const out = await reply();
    expect(out.ok).toBe(true);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendMedia).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
  });

  it("records no attachment against it", async () => {
    await reply();
    expect(rows[0].document_name).toBe("");
  });
});

describe("a reply with a file", () => {
  it("uploads it and sends ONE message, not two", async () => {
    const out = await reply({ attachment: FILE });
    expect(out.ok).toBe(true);
    expect(uploadMedia).toHaveBeenCalledTimes(1);
    expect(sendMedia).toHaveBeenCalledTimes(1);
    /* The words went WITH the file. A second text message could arrive
       before it, or not at all. */
    expect(sendText).not.toHaveBeenCalled();
  });

  it("carries the typed words as the caption", async () => {
    await reply({ attachment: FILE });
    expect(sendMedia.mock.calls[0][0].caption).toBe("Here you go");
  });

  it("hands Meta the kind and the type the rules decided, not a guess", async () => {
    await reply({ attachment: { ...FILE, kind: "image", mimeType: "image/png", filename: "rack.png" } });
    expect(uploadMedia.mock.calls[0][0].mimeType).toBe("image/png");
    expect(sendMedia.mock.calls[0][0].kind).toBe("image");
  });

  it("sends the uploaded id, never the bytes again", async () => {
    await reply({ attachment: FILE });
    expect(sendMedia.mock.calls[0][0].mediaId).toBe("media-9");
  });

  it("goes with no words at all — a file on its own is a message", async () => {
    const out = await reply({ attachment: FILE, body: "" });
    expect(out.ok).toBe(true);
    expect(sendMedia.mock.calls[0][0].caption).toBe("");
  });

  it("WRITES THE FILE'S NAME INTO THE HISTORY", async () => {
    /* The thread on screen reads document_name to show the paperclip, so
       a message sent with a file that recorded none looks like a bare
       line of text for ever afterwards. */
    await reply({ attachment: FILE });
    expect(rows[0].document_name).toBe("Price list.pdf");
    expect(rows[0].status).toBe("sent");
    expect(rows[0].trigger).toBe("reply");
  });
});

describe("when it does not go", () => {
  it("does not send anything if the upload was refused", async () => {
    uploadMedia.mockResolvedValue({ ok: false, error: "WhatsApp would not accept that kind of file." });
    const out = await reply({ attachment: FILE });
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("would not accept");
    expect(sendMedia).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("writes a refused upload into the history rather than losing it", async () => {
    /* A refusal that only ever appeared in a toast is a message the
       salesperson believes they sent. */
    uploadMedia.mockResolvedValue({ ok: false, error: "That file is too large for WhatsApp to accept." });
    await reply({ attachment: FILE });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toContain("too large");
    expect(rows[0].document_name).toBe("Price list.pdf");
  });

  it("writes a refused SEND into the history too, with the file named", async () => {
    sendMedia.mockResolvedValue({ ok: false, error: "Outside the 24-hour window." });
    const out = await reply({ attachment: FILE });
    expect(out.ok).toBe(false);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].document_name).toBe("Price list.pdf");
  });
});
