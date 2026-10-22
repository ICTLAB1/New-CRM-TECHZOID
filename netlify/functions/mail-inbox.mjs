import { fail, guard, json, readJson } from "../lib/http.mjs";
import { adminClient, signedInUser } from "../lib/auth.mjs";
import { consume, tooManyMessage } from "../lib/ratelimit.mjs";
import {
  addAttachment, createDraft, deleteMessage, getAttachment, getMessage,
  listAttachments, listFolders, listMessages, moveMessage, readToken,
  sendDraft, sendNew, setRead, updateDraft,
} from "../lib/mailbox.mjs";

/**
 * One person's mailbox: folders, messages, drafts, sending.
 *
 * ALWAYS THEIR OWN. The user id comes from the verified token and is never
 * read from the request — there is no parameter here that could name
 * somebody else's mailbox, and that is the only reason one endpoint can
 * safely carry this much.
 *
 * Actions rather than routes because the Functions host maps one file to one
 * path, and eleven files that each re-check the token and the rate limit is
 * eleven places for that check to be forgotten.
 */

const ACTIONS = new Set([
  "folders", "list", "read", "markRead", "draft", "saveDraft", "send", "sendNew", "delete", "move",
  "attachments", "attachment", "attach",
]);

export async function handler(event) {
  const stop = guard(event);
  if (stop) return stop;

  const user = await signedInUser(event);
  if (!user) return fail(event, 403, "Sign in required.");

  const body = readJson(event) ?? {};
  const action = String(body.action ?? "list");
  if (!ACTIONS.has(action)) return fail(event, 400, "That request wasn't valid.");

  const admin = adminClient();
  try {
    const rl = await consume(admin, "mail-inbox", user.id);
    if (!rl.allowed) return fail(event, 429, tooManyMessage(rl.retryAfterSeconds));
  } catch (err) {
    console.error("rate limit unavailable:", err?.message ?? err);
  }

  const access = await readToken(admin, user.id);
  if (!access.ok) {
    /* 409, not 403: nothing is forbidden, something is not set up yet, and
       the screen needs to tell those apart to know whether to offer the
       Connect button. */
    return fail(event, access.needsConsent ? 409 : 400, access.error);
  }
  const token = access.token;
  const id = String(body.id ?? "");
  const fields = {
    to: body.to, cc: body.cc, bcc: body.bcc, subject: body.subject, body: body.body,
  };

  switch (action) {
    case "folders": {
      const got = await listFolders(token);
      return got.ok ? json(event, 200, { folders: got.folders, mailbox: access.email })
                    : fail(event, 502, got.error);
    }
    case "read": {
      if (!id) return fail(event, 400, "Which message?");
      const got = await getMessage(token, id);
      return got.ok ? json(event, 200, { message: got.message, mailbox: access.email })
                    : fail(event, 502, got.error);
    }
    case "markRead": {
      if (!id) return fail(event, 400, "Which message?");
      const done = await setRead(token, id, body.markRead !== false);
      /* 200 either way: failing to mark a message read is not a failure to
         show it. */
      return json(event, 200, { ok: done.ok, error: done.ok ? null : done.error });
    }
    case "draft": {
      const made = await createDraft(token, fields);
      return made.ok ? json(event, 200, { id: made.id }) : fail(event, 502, made.error);
    }
    case "saveDraft": {
      if (!id) return fail(event, 400, "Which draft?");
      const saved = await updateDraft(token, id, fields);
      return saved.ok ? json(event, 200, { id }) : fail(event, 502, saved.error);
    }
    case "send": {
      if (!id) return fail(event, 400, "Which draft?");
      const sent = await sendDraft(token, id);
      return sent.ok ? json(event, 200, { ok: true }) : fail(event, 502, sent.error);
    }
    case "sendNew": {
      const sent = await sendNew(token, fields);
      return sent.ok ? json(event, 200, { ok: true }) : fail(event, 502, sent.error);
    }
    case "attachments": {
      if (!id) return fail(event, 400, "Which message?");
      const got = await listAttachments(token, id);
      return got.ok ? json(event, 200, { attachments: got.attachments }) : fail(event, 502, got.error);
    }
    case "attachment": {
      if (!id || !body.attachmentId) return fail(event, 400, "Which attachment?");
      const got = await getAttachment(token, id, String(body.attachmentId));
      return got.ok ? json(event, 200, { attachment: got.attachment }) : fail(event, 502, got.error);
    }
    case "attach": {
      if (!id) return fail(event, 400, "Which draft?");
      const done = await addAttachment(token, id, {
        name: body.name, contentType: body.contentType, base64: body.base64,
      });
      /* The size refusal is the caller's mistake, not the mailbox's, so it
         comes back as 413 rather than a bad gateway. */
      return done.ok ? json(event, 200, { ok: true }) : fail(event, done.status === 413 ? 413 : 502, done.error);
    }
    case "delete": {
      if (!id) return fail(event, 400, "Which message?");
      const gone = await deleteMessage(token, id);
      return gone.ok ? json(event, 200, { ok: true }) : fail(event, 502, gone.error);
    }
    case "move": {
      if (!id || !body.folderId) return fail(event, 400, "Which message, and where to?");
      const moved = await moveMessage(token, id, String(body.folderId));
      return moved.ok ? json(event, 200, { ok: true }) : fail(event, 502, moved.error);
    }
    default: {
      const page = await listMessages(token, {
        folder: String(body.folder ?? "inbox"),
        top: body.top,
        skip: body.skip,
        search: String(body.search ?? "").slice(0, 120),
      });
      return page.ok ? json(event, 200, { messages: page.messages, mailbox: access.email })
                     : fail(event, 502, page.error);
    }
  }
}
