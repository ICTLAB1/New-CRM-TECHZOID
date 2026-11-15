/**
 * Reading what Meta sends to the webhook.
 *
 * Kept apart from the endpoint so the shapes can be asserted without a
 * database or an HTTP request. Meta's payload is deeply nested, arrives in
 * batches, mixes two completely different kinds of event in one envelope,
 * and is versioned — so the parsing is the part most likely to be quietly
 * wrong, and the part worth pinning hardest.
 *
 * TWO KINDS OF EVENT, in the same POST:
 *
 *   · `messages` — a customer wrote to us. The business number is API-only,
 *     so these reach nobody's phone: if this endpoint drops one, the
 *     customer is simply ignored, which is the worst outcome in the whole
 *     feature.
 *   · `statuses` — what happened to something we sent: sent, delivered,
 *     read, or failed, each arriving minutes or hours apart.
 */

/** sent → delivered → read. A later event never walks one of these back. */
const RANK = { queued: 0, sent: 1, delivered: 2, read: 3 };

/**
 * The status a row should end up at.
 *
 * META DOES NOT GUARANTEE ORDER. "delivered" and "read" can arrive in
 * either order, and a retried webhook can replay an old one hours later. A
 * message the customer has read must not go back to "delivered" because a
 * duplicate turned up — the history on screen would appear to run
 * backwards.
 *
 * `failed` is the exception and always wins: it is the one status that
 * means somebody has to do something.
 */
export function nextStatus(current, incoming) {
  const from = String(current ?? "").toLowerCase();
  const to = String(incoming ?? "").toLowerCase();

  if (!(to in RANK) && to !== "failed") return from || "queued";
  if (to === "failed") return "failed";
  /* Already failed: a stray "sent" afterwards does not undo the failure. */
  if (from === "failed") return "failed";
  return (RANK[to] ?? 0) > (RANK[from] ?? -1) ? to : from || to;
}

/** The text of an incoming message, whatever kind it is. */
export function describeIncoming(message) {
  const type = String(message?.type ?? "").toLowerCase();

  if (type === "text") return String(message?.text?.body ?? "");
  if (type === "button") return String(message?.button?.text ?? "");
  if (type === "interactive") {
    const i = message?.interactive ?? {};
    return String(i?.button_reply?.title ?? i?.list_reply?.title ?? "");
  }
  if (type === "reaction") {
    const emoji = String(message?.reaction?.emoji ?? "");
    return emoji ? `Reacted ${emoji}` : "Reacted to a message";
  }
  /* A PICTURE OR A DOCUMENT IS STILL A REPLY. A customer sending their
     purchase order as a PDF must show up in the inbox as something
     happening, not as an empty line — even though the file itself is not
     fetched here. The caption is theirs, so it is kept. */
  if (["image", "document", "audio", "video", "sticker", "voice"].includes(type)) {
    const caption = String(message?.[type]?.caption ?? "").trim();
    const name = String(message?.[type]?.filename ?? "").trim();
    const what = type === "voice" ? "a voice note" : `a ${type}`;
    return [`[${what}${name ? `: ${name}` : ""}]`, caption].filter(Boolean).join(" ");
  }
  if (type === "location") {
    const l = message?.location ?? {};
    return `[location${l.name ? `: ${l.name}` : ""}]`;
  }
  if (type === "contacts") return "[a contact card]";
  if (type === "unsupported") return "[a message WhatsApp could not show]";
  return type ? `[${type}]` : "";
}

/** Meta's seconds-since-epoch, as an ISO timestamp. */
export function whenOf(timestamp) {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

/**
 * Everything worth acting on, flattened out of the envelope.
 *
 * Returns `{ messages, statuses }`, both already normalised. Anything not
 * understood is dropped rather than guessed at — but the endpoint logs the
 * shape, so an unexpected payload is visible instead of silent.
 */
export function parseWebhook(payload) {
  const messages = [];
  const statuses = [];

  for (const entry of asArray(payload?.entry)) {
    for (const change of asArray(entry?.change ?? entry?.changes)) {
      /* Meta sends other kinds of change on the same hook — template
         approvals, quality ratings, phone-number updates. Only messages
         are ours. */
      if (change?.field && String(change.field) !== "messages") continue;
      const value = change?.value ?? {};

      /* The sender's WhatsApp profile name, which is often the only name
         we will ever have for a stranger messaging in. */
      const names = new Map();
      for (const contact of asArray(value?.contacts)) {
        const id = String(contact?.wa_id ?? "");
        const name = String(contact?.profile?.name ?? "").trim();
        if (id && name) names.set(id, name);
      }

      for (const message of asArray(value?.messages)) {
        const from = String(message?.from ?? "").replace(/[^0-9]/g, "");
        if (!from) continue;
        messages.push({
          waMessageId: String(message?.id ?? ""),
          from,
          name: names.get(from) ?? "",
          type: String(message?.type ?? ""),
          body: describeIncoming(message),
          at: whenOf(message?.timestamp),
          /* What they were replying to, when they used WhatsApp's reply. */
          repliesTo: String(message?.context?.id ?? ""),
        });
      }

      for (const status of asArray(value?.statuses)) {
        const id = String(status?.id ?? "");
        if (!id) continue;
        const error = asArray(status?.errors)[0] ?? null;
        statuses.push({
          waMessageId: id,
          status: String(status?.status ?? "").toLowerCase(),
          at: whenOf(status?.timestamp),
          recipient: String(status?.recipient_id ?? "").replace(/[^0-9]/g, ""),
          error: error
            ? String(error.title ?? error.message ?? error.details ?? `WhatsApp error ${error.code ?? ""}`).trim()
            : "",
        });
      }
    }
  }

  return { messages, statuses };
}

const asArray = (v) => (Array.isArray(v) ? v : []);
