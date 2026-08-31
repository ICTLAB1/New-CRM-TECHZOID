import { clientIp, fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import { str } from "../lib/validate.mjs";
import { resolveToken } from "../lib/portalToken.mjs";

/**
 * A customer accepting or declining a quotation.
 *
 * The only write anybody reaches through a portal link, and it is kept as
 * small as a write can be: one column, on one row, which must be a quotation,
 * which must belong to the customer the link names, and which must currently
 * be "Sent". Nothing about the document is taken from the request except its
 * id — no status to set, no amount, no fields to merge. The request says which
 * document and which of two words; everything else is decided here.
 *
 * IDEMPOTENT, because it has to be: this is a button in an email client that
 * may be behind a link prefetcher, on a phone with a flaky connection, pressed
 * twice by a person who did not see the first one land. Responding again with
 * the same answer succeeds quietly. Responding with the OPPOSITE answer does
 * not — reversing an acceptance is a conversation, not a click.
 */

const ANSWERS = {
  accept: { status: "Accepted", verb: "accepted" },
  decline: { status: "Rejected", verb: "declined" },
};

export async function handler(event) {
  const stop = guard(event, "POST", "POST, OPTIONS");
  if (stop) return stop;

  const body = readJson(event);
  if (!body) return fail(event, 400, "That didn't come through properly.", null, "POST, OPTIONS");

  const token = str(body.token, 200);
  const documentId = str(body.documentId, 64);
  const answer = ANSWERS[str(body.answer, 20).toLowerCase()];
  const note = str(body.note, 1000);
  const signedBy = str(body.signedBy, 120);

  if (!token || !documentId || !answer) {
    return fail(event, 400, "That didn't come through properly.", null, "POST, OPTIONS");
  }

  let admin;
  try {
    admin = adminClient();
  } catch (err) {
    return fail(event, 500, "This page isn't available just now.", err?.message, "POST, OPTIONS");
  }

  const rl = await consume(admin, "portal-respond", clientIp(event));
  if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds), null, "POST, OPTIONS");

  try {
    const found = await resolveToken(admin, token);
    if (!found.ok) {
      console.warn("portal response rejected:", found.reason);
      return fail(event, 403, "This link is no longer active. Please ask for a fresh one.", null, "POST, OPTIONS");
    }

    /* Both the id AND the customer are in the filter. A link holder who
       guesses another customer's document id gets no row, not their
       document. */
    const { data: row, error } = await admin
      .from("quotes")
      .select("id, customer_id, data")
      .eq("id", documentId)
      .eq("customer_id", found.link.customer_id)
      .maybeSingle();
    if (error) throw error;
    if (!row) return fail(event, 404, "We couldn't find that quotation.", null, "POST, OPTIONS");

    const current = String(row.data?.status ?? "").trim().toLowerCase();

    if (current === answer.status.toLowerCase()) {
      /* Already recorded, same answer. Say so as a success — the customer
         pressed the button twice and both times it worked. */
      return json(event, 200, { ok: true, status: answer.status, alreadyRecorded: true }, "POST, OPTIONS");
    }
    if (current !== "sent") {
      return fail(
        event, 409,
        current === "accepted" || current === "rejected"
          ? "This quotation has already been answered. Please speak to your contact to change it."
          : "This quotation isn't open for a response.",
        null, "POST, OPTIONS",
      );
    }

    const now = Date.now();
    const who = signedBy || "the customer";
    const nextData = {
      ...row.data,
      status: answer.status,
      /* Kept on the document, not only in the timeline: what the salesperson
         needs when they ask "who accepted this and when". */
      customerResponse: {
        answer: answer.status,
        at: now,
        by: signedBy,
        note,
        /* Enough to distinguish "them" from "somebody else with the link" if
           it is ever disputed, and no more. Not stored anywhere it can be
           read by another customer — this row is theirs. */
        ip: clientIp(event),
      },
      updatedAt: now,
    };

    const { error: writeError } = await admin
      .from("quotes")
      .update({ data: nextData, updated_at: new Date(now).toISOString() })
      .eq("id", row.id)
      .eq("customer_id", found.link.customer_id);
    if (writeError) throw writeError;

    /* And into the customer's activity timeline, so it reaches the
       salesperson where they already look rather than only on a document
       they may not open for a week. Best-effort: the answer is recorded
       above, and losing the timeline entry must not fail the response the
       customer just gave. */
    await appendTimelineNote(admin, found.link.customer_id, {
      text: `Quotation ${str(row.data?.number, 80) || row.id} ${answer.verb} through the customer portal${who !== "the customer" ? ` by ${who}` : ""}.${note ? ` They said: ${note}` : ""}`,
      by: who,
      at: now,
    });

    return json(event, 200, { ok: true, status: answer.status }, "POST, OPTIONS");
  } catch (err) {
    return fail(event, 500, "We couldn't record that. Please try again in a moment.", err?.message, "POST, OPTIONS");
  }
}

/**
 * Append one note to a customer's timeline.
 *
 * Read-modify-write on a jsonb array, which is a lost update waiting to
 * happen if two of these race. They effectively cannot: this runs only when a
 * customer presses a button on their own record, and the endpoint is rate
 * limited. Worth the honesty in a comment rather than a claim of safety it
 * does not have — if portal writes ever become frequent this needs to move
 * into a jsonb append in the database.
 */
async function appendTimelineNote(admin, customerId, { text, by, at }) {
  try {
    const { data: customer } = await admin
      .from("customers").select("data").eq("id", customerId).maybeSingle();
    if (!customer) return;

    const notes = Array.isArray(customer.data?.notes) ? customer.data.notes : [];
    notes.unshift({
      id: `portal-${at}-${Math.random().toString(36).slice(2, 8)}`,
      ts: at,
      /* `userId` is empty on purpose. Every other note names a member of
         staff; attributing this one to a profile would put words in
         somebody's mouth. The timeline renders an unattributed note as
         coming from outside, which is exactly what it is. */
      userId: "",
      user: by,
      type: "Note",
      text,
    });

    await admin
      .from("customers")
      .update({ data: { ...customer.data, notes: notes.slice(0, 500) }, updated_at: new Date(at).toISOString() })
      .eq("id", customerId);
  } catch (err) {
    console.error("portal timeline note:", err?.message ?? err);
  }
}
