import { READ_SCOPES } from "./mailer.mjs";

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
    console.error("inbox refresh failed:", resp.status, tok?.error);
    return {
      ok: false,
      error: "Your inbox connection has expired. Reconnect it in Settings → Integrations.",
      needsConsent: true,
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
