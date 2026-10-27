import { READ_SCOPES } from "./mailer.mjs";
import { refreshFailure } from "./aadsts.mjs";

/**
 * Reading one person's Microsoft mailbox.
 *
 * SEPARATE FROM SENDING, ALL THE WAY DOWN. A different grant, a different
 * refresh token, a different column, and this file — which never touches
 * `refresh_token`. The reason is in mailer.mjs: a refresh may ask for a
 * subset of what was consented and never a superset, so the moment one token
 * tries to cover both, every mailbox consented before stops refreshing and
 * quotations stop going out. Reading failing must only ever cost the inbox.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

/** What a browser is allowed to know about a message. Never the raw Graph
 *  object: it carries headers, ids and routing detail no screen needs. */
function summarise(m) {
  const from = m?.from?.emailAddress ?? m?.sender?.emailAddress ?? {};
  return {
    id: String(m?.id ?? ""),
    conversationId: String(m?.conversationId ?? ""),
    subject: String(m?.subject ?? "(no subject)"),
    preview: String(m?.bodyPreview ?? ""),
    from: { name: String(from.name ?? ""), address: String(from.address ?? "") },
    to: (m?.toRecipients ?? []).map((r) => String(r?.emailAddress?.address ?? "")).filter(Boolean),
    receivedAt: String(m?.receivedDateTime ?? ""),
    unread: m?.isRead === false,
    hasAttachments: !!m?.hasAttachments,
  };
}

/**
 * An access token for reading, or a reason there isn't one.
 *
 * @returns {{ok: true, token: string, email: string} | {ok: false, error: string, needsConsent?: boolean}}
 */
export async function readToken(admin, userId, env = process.env) {
  if (!env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) {
    return { ok: false, error: "Microsoft 365 isn't set up on the server." };
  }

  let row = null;
  try {
    const { data } = await admin.from("ms_mail_accounts")
      .select("ms_email, read_refresh_token").eq("user_id", userId).maybeSingle();
    row = data ?? null;
  } catch (err) {
    console.error("inbox lookup failed:", err?.message ?? err);
    return { ok: false, error: "Could not read your mailbox settings." };
  }

  if (!row?.read_refresh_token) {
    /* Not an error: most people have connected for sending and never turned
       reading on. The screen offers the button rather than reporting a
       fault. */
    return { ok: false, error: "Your inbox isn't connected yet.", needsConsent: true };
  }

  const tenant = env.MS_TENANT_ID || "common";
  const resp = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      refresh_token: row.read_refresh_token,
      grant_type: "refresh_token",
      scope: READ_SCOPES,
    }).toString(),
  });
  const tok = await resp.json().catch(() => ({}));

  if (!resp.ok || !tok.access_token) {
    const why = refreshFailure(tok, { what: "inbox connection", email: String(row.ms_email ?? "") });
    console.error("inbox refresh failed:", resp.status, why.code ?? tok?.error);
    return {
      ok: false,
      error: why.error,
      /* Offering the Connect button for a fault no reconnection can fix is
         how somebody ends up pressing it all afternoon. */
      needsConsent: why.reconnect,
      code: why.code,
    };
  }

  /* Microsoft rotates refresh tokens. Storing the new one in the READ column
     only — writing it over `refresh_token` would quietly replace a Mail.Send
     grant with a Mail.Read one and stop this person's quotations. */
  if (tok.refresh_token && tok.refresh_token !== row.read_refresh_token) {
    const { error } = await admin.from("ms_mail_accounts")
      .update({ read_refresh_token: tok.refresh_token, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (error) console.error("could not store rotated inbox token:", error.message);
  }

  return { ok: true, token: tok.access_token, email: String(row.ms_email ?? "") };
}

/** One page of a folder, newest first. */
export async function listMessages(token, { folder = "inbox", top = 25, skip = 0, search = "" } = {}) {
  const params = new URLSearchParams({
    $select: "id,conversationId,subject,bodyPreview,from,sender,toRecipients,receivedDateTime,isRead,hasAttachments",
    $top: String(Math.min(Math.max(Number(top) || 25, 1), 50)),
    $skip: String(Math.max(Number(skip) || 0, 0)),
  });
  /* $search and $orderby cannot be combined on Graph; a search is already
     relevance-ordered, and asking for both returns an error rather than
     either one. */
  if (search) params.set("$search", `"${String(search).replace(/"/g, "")}"`);
  else params.set("$orderby", "receivedDateTime desc");

  const url = `${GRAPH}/me/mailFolders/${encodeURIComponent(folder)}/messages?${params}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" } });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("inbox list refused:", resp.status, body?.error?.code);
    return { ok: false, status: resp.status, error: body?.error?.message ?? "Could not read the mailbox." };
  }
  return { ok: true, messages: (body.value ?? []).map(summarise) };
}

/** One message, with its body. */
export async function getMessage(token, id) {
  const url = `${GRAPH}/me/messages/${encodeURIComponent(id)}`
    + "?$select=id,conversationId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments";
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("message read refused:", resp.status, body?.error?.code);
    return { ok: false, status: resp.status, error: body?.error?.message ?? "Could not read that message." };
  }
  return {
    ok: true,
    message: {
      ...summarise(body),
      cc: (body.ccRecipients ?? []).map((r) => String(r?.emailAddress?.address ?? "")).filter(Boolean),
      contentType: String(body?.body?.contentType ?? "text"),
      content: String(body?.body?.content ?? ""),
    },
  };
}

/**
 * Mark one message read or unread.
 *
 * Mail.Read does not permit this — writing to a message needs Mail.ReadWrite
 * — so a refusal here is expected on the narrow grant and must not read as a
 * fault. The caller reports it as "could not mark it read", and the message
 * is still perfectly readable.
 */
export async function setRead(token, id, isRead = true) {
  const resp = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ isRead: !!isRead }),
  });
  if (resp.ok) return { ok: true };
  const body = await resp.json().catch(() => ({}));
  console.warn("mark read refused:", resp.status, body?.error?.code);
  return { ok: false, status: resp.status, error: "Could not change whether that is marked read." };
}

/* ── folders ──────────────────────────────────────────────────────────── */

/**
 * The folders a mail client shows down the side, with unread counts.
 *
 * Graph names the well-known ones in English regardless of the mailbox's
 * language, and those names are what `listMessages` accepts as a folder —
 * so the id is what gets passed around and the display name is only ever
 * shown. A mailbox in another language would otherwise have a sidebar that
 * works and labels that do not.
 */
export async function listFolders(token) {
  const url = `${GRAPH}/me/mailFolders?$top=40&$select=id,displayName,unreadItemCount,totalItemCount`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("folder list refused:", resp.status, body?.error?.code);
    return { ok: false, status: resp.status, error: "Could not read your folders." };
  }
  return {
    ok: true,
    folders: (body.value ?? []).map((f) => ({
      id: String(f?.id ?? ""),
      name: String(f?.displayName ?? ""),
      unread: Number(f?.unreadItemCount ?? 0),
      total: Number(f?.totalItemCount ?? 0),
    })),
  };
}

/* ── writing ──────────────────────────────────────────────────────────── */

const recipients = (list) =>
  (Array.isArray(list) ? list : String(list ?? "").split(/[,;]/))
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.includes("@"))
    .map((address) => ({ emailAddress: { address } }));

function draftBody({ to, cc, bcc, subject, body }) {
  return {
    subject: String(subject ?? ""),
    /* Text, not HTML. What somebody typed into a box is text, and sending it
       as HTML means their angle brackets and ampersands arrive mangled. */
    body: { contentType: "Text", content: String(body ?? "") },
    toRecipients: recipients(to),
    ...(cc && recipients(cc).length ? { ccRecipients: recipients(cc) } : {}),
    /* Blind copies are sent and then NOT echoed back by Graph on a read, which
       is the whole point of them. Nothing in this file tries to display them
       afterwards; a Bcc that showed up in the sent copy would expose exactly
       the address the sender meant to hide. */
    ...(bcc && recipients(bcc).length ? { bccRecipients: recipients(bcc) } : {}),
  };
}

/** Save a new draft. Returns its id, which is how it is edited and sent. */
export async function createDraft(token, fields) {
  const resp = await fetch(`${GRAPH}/me/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(draftBody(fields)),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("draft create refused:", resp.status, body?.error?.code);
    return { ok: false, status: resp.status, error: "Could not save that draft." };
  }
  return { ok: true, id: String(body?.id ?? "") };
}

/** Update a draft in place. */
export async function updateDraft(token, id, fields) {
  const resp = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(draftBody(fields)),
  });
  if (resp.ok) return { ok: true, id };
  const body = await resp.json().catch(() => ({}));
  console.error("draft update refused:", resp.status, body?.error?.code);
  return { ok: false, status: resp.status, error: "Could not save that draft." };
}

/**
 * Send a draft.
 *
 * Graph answers 202 with no body. Treating a missing body as a failure would
 * report a sent message as unsent and invite somebody to send it twice.
 */
export async function sendDraft(token, id) {
  const resp = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Length": "0" },
  });
  if (resp.ok || resp.status === 202) return { ok: true };
  const body = await resp.json().catch(() => ({}));
  console.error("send refused:", resp.status, body?.error?.code);
  return { ok: false, status: resp.status, error: body?.error?.message ?? "Could not send that message." };
}

/** Compose and send in one step, for a message nobody wants kept as a draft. */
export async function sendNew(token, fields) {
  const resp = await fetch(`${GRAPH}/me/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: draftBody(fields), saveToSentItems: true }),
  });
  if (resp.ok || resp.status === 202) return { ok: true };
  const body = await resp.json().catch(() => ({}));
  console.error("sendMail refused:", resp.status, body?.error?.code);
  return { ok: false, status: resp.status, error: body?.error?.message ?? "Could not send that message." };
}

/**
 * Delete a message.
 *
 * To Deleted Items, never permanently: Graph's DELETE on a message is a move
 * to the deleted folder, which is what a person means by delete and what
 * they can undo from Outlook. A permanent one is a different call and this
 * deliberately is not it.
 */
export async function deleteMessage(token, id) {
  const resp = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.ok || resp.status === 204) return { ok: true };
  console.error("delete refused:", resp.status);
  return { ok: false, status: resp.status, error: "Could not delete that message." };
}

/** Move a message to another folder. */
export async function moveMessage(token, id, destinationId) {
  const resp = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(id)}/move`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ destinationId: String(destinationId) }),
  });
  if (resp.ok) return { ok: true };
  const body = await resp.json().catch(() => ({}));
  console.error("move refused:", resp.status, body?.error?.code);
  return { ok: false, status: resp.status, error: "Could not move that message." };
}

/* ── attachments ──────────────────────────────────────────────────────── */

/**
 * Graph takes an attachment inline up to about 3 MB; past that it wants an
 * upload session, which is a different protocol and not built here. The cap
 * is stated to the caller rather than discovered as a 413 halfway through
 * sending, because by then the person has already written the email.
 */
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

/** Graph's ceiling for an upload session. Past this there is no mechanism. */
export const MAX_LARGE_ATTACHMENT_BYTES = 150 * 1024 * 1024;

/**
 * Exchange Online's DEFAULT message size limit, which an administrator can
 * raise to 150 MB. It is not ours to enforce and we do not know this
 * tenant's setting, so it is a warning and never a refusal: a mailbox
 * configured for 100 MB should not be stopped by a number hardcoded here.
 */
export const TYPICAL_MESSAGE_LIMIT_BYTES = 35 * 1024 * 1024;

/** What is on a message, without pulling the contents of any of it down. */
export async function listAttachments(token, id) {
  const url = `${GRAPH}/me/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("attachment list refused:", resp.status, body?.error?.code);
    return { ok: false, status: resp.status, error: "Could not list the attachments." };
  }
  return {
    ok: true,
    attachments: (body.value ?? [])
      /* Inline images are the signature logos and tracking pixels that make
         up most of a marketing email. Listing them as files to download
         buries the one attachment somebody actually wants. */
      .filter((a) => !a?.isInline)
      .map((a) => ({
        id: String(a?.id ?? ""),
        name: String(a?.name ?? "attachment"),
        contentType: String(a?.contentType ?? "application/octet-stream"),
        size: Number(a?.size ?? 0),
      })),
  };
}

/** One attachment's bytes, base64, for the browser to save. */
export async function getAttachment(token, messageId, attachmentId) {
  const url = `${GRAPH}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error("attachment read refused:", resp.status, body?.error?.code);
    return { ok: false, status: resp.status, error: "Could not download that attachment." };
  }
  return {
    ok: true,
    attachment: {
      name: String(body?.name ?? "attachment"),
      contentType: String(body?.contentType ?? "application/octet-stream"),
      base64: String(body?.contentBytes ?? ""),
    },
  };
}

/** Put a file on a draft. The draft has to exist first — it is what holds it. */
export async function addAttachment(token, draftId, { name, contentType, base64 }) {
  const bytes = Math.ceil((String(base64 ?? "").length * 3) / 4);
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, status: 413, error: `${name} is too large to attach here. Keep each file under 3 MB.` };
  }
  const resp = await fetch(`${GRAPH}/me/messages/${encodeURIComponent(draftId)}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: String(name ?? "attachment"),
      contentType: String(contentType ?? "application/octet-stream"),
      contentBytes: String(base64 ?? ""),
    }),
  });
  if (resp.ok) return { ok: true };
  const body = await resp.json().catch(() => ({}));
  console.error("attach refused:", resp.status, body?.error?.code);
  return { ok: false, status: resp.status, error: `Could not attach ${name}.` };
}

/**
 * Begin a chunked upload for a file too big to attach in one request.
 *
 * Returns Microsoft's upload URL, which the BROWSER then PUTs chunks to
 * directly. Two reasons it does not go through this server: the API has an
 * 8 MB body cap, so a 30 MB file could not pass through it at all; and
 * relaying tens of megabytes twice would make every large attachment cost
 * double the bandwidth and twice the wait for no gain.
 *
 * The URL is pre-authenticated and carries its own short-lived token, which
 * is why the browser must NOT send an Authorization header with it. It
 * grants exactly one thing — writing the bytes of this one attachment on
 * this one draft — and expires on its own.
 *
 * UNDER 3 MB THIS IS THE WRONG CALL. Graph refuses a session for a smaller
 * file (ErrorAttachmentSizeShouldNotBeLessThanMinimumSize); those go through
 * addAttachment in a single request. Both paths have to exist.
 */
export async function createAttachmentSession(token, draftId, { name, contentType, size }) {
  const bytes = Number(size) || 0;
  if (bytes <= MAX_ATTACHMENT_BYTES) {
    return { ok: false, status: 400, error: "That file is small enough to attach directly." };
  }
  if (bytes > MAX_LARGE_ATTACHMENT_BYTES) {
    return { ok: false, status: 413, error: `${name} is larger than 150 MB, which is the most Outlook will accept.` };
  }

  const resp = await fetch(
    `${GRAPH}/me/messages/${encodeURIComponent(draftId)}/attachments/createUploadSession`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: "file",
          name: String(name ?? "attachment"),
          contentType: String(contentType ?? "application/octet-stream"),
          size: bytes,
        },
      }),
    },
  );
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || !body?.uploadUrl) {
    console.error("upload session refused:", resp.status, body?.error?.code);
    return { ok: false, status: resp.status, error: `Could not start the upload for ${name}.` };
  }
  return { ok: true, uploadUrl: String(body.uploadUrl), expiresAt: String(body.expirationDateTime ?? "") };
}
