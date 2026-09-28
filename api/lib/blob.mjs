import { asUser } from "./db.mjs";
import { AuthError, callerOf } from "./identity.mjs";
import { QueryError } from "./query.mjs";

/**
 * Attachments, on Azure Blob Storage.
 *
 * WHAT THIS REPLACES. Supabase Storage answered three questions for the
 * browser — write these bytes, give me a link that expires, delete them —
 * and decided who was allowed to by running its own bucket policies. Azure
 * Blob Storage will happily do the first three and has no opinion whatever
 * about the fourth. This supplies the opinion, and it supplies it by asking
 * the database rather than by having one of its own.
 *
 * HOW PERMISSION IS DECIDED, AND WHY IT IS NOT DECIDED HERE:
 *
 *   READ.   The caller names a path. Before any URL is issued, the
 *           `attachments` row for that path is looked up AS THE CALLER, so
 *           the same policies that decide whether they may see the
 *           attachment in a list decide whether they may open it. No row,
 *           no link — and a caller who may not see it gets exactly the
 *           answer a caller asking about a file that does not exist gets.
 *
 *   WRITE.  There is no row yet, so there is nothing to ask the policies
 *           about. The rule is the one Supabase's storage policy enforced:
 *           the first segment of the path is the uploader's own user id,
 *           and you may only write inside your own. Checked against the
 *           VERIFIED token, never against anything in the request body.
 *
 *   DELETE. The row is deleted first, as the caller, so the policies decide.
 *           Only the paths that actually came back are removed from the
 *           store — and if removing them fails, the transaction rolls back
 *           and the rows return. That is stricter than the Supabase version,
 *           which deleted the object first and could leave a row pointing at
 *           nothing if the row delete then failed.
 *
 * THE SAS IS SCOPED TO ONE BLOB AND EXPIRES. It is a user-delegation SAS,
 * signed with a key obtained from Entra ID by the function app's managed
 * identity, because the storage account has shared-key access turned off
 * entirely. There is no account key in this system to leak, and a leaked SAS
 * is one file for a few minutes.
 */

/** How long a download link stays good. Long enough to click, short enough
 *  that a link pasted into a chat is not a lasting way in. */
const READ_SECONDS = 5 * 60;

/** Uploads are immediate. A window this size is for a slow connection on a
 *  large file, not for holding a credential. */
const WRITE_SECONDS = 15 * 60;

const MAX_PATHS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Paths are caller-supplied and end up in a URL and a blob name.
 *
 * Rejected rather than escaped: `..` and a leading slash are the two shapes
 * that traverse, and a path containing them is not a path this application
 * ever generates. `storagePath()` in the browser builds
 * `<uploader>/<record-type>/<record-id>/<unique>-<name>`.
 */
function checkPath(path) {
  const value = String(path ?? "");
  if (!value || value.length > 1024) throw new QueryError("Bad path.");
  if (value.startsWith("/") || value.includes("..") || value.includes("\\")) {
    throw new QueryError("Bad path.");
  }
  if (!/^[A-Za-z0-9._\-/() ]+$/.test(value)) throw new QueryError("Bad path.");
  return value;
}

/** The uploader's own folder is the first segment. */
function ownsPath(path, userId) {
  const first = path.split("/")[0];
  return UUID.test(first) && first.toLowerCase() === String(userId).toLowerCase();
}

/**
 * Handle one blob request.
 *
 * @param blobs The Azure client, injected. Everything except the calls to
 *   Azure itself is then testable without Azure — which matters, because
 *   the parts worth testing are the permission checks and not the SDK.
 */
export async function handleBlob(request, options = {}) {
  const blobs = options.blobs ?? null;
  try {
    if (request.method !== "POST") throw new QueryError("Use POST.", 405);
    const contentType = String(request.headers?.get?.("content-type") ?? "");
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new QueryError("Send application/json.", 415);
    }

    let body;
    try {
      body = JSON.parse(await request.text());
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    } catch {
      throw new QueryError("That is not a JSON object.");
    }

    /* Files are never anonymous. Unlike `/api/q`, where an unauthenticated
       caller is a legitimate visitor who sees nothing, there is no public
       attachment and no reason to issue a signed URL to nobody. */
    const caller = await callerOf(request.headers?.get?.("authorization"), options);
    if (!caller) throw new AuthError("Sign in to use attachments.");
    if (!blobs) throw new QueryError("Attachment storage is not configured.", 503);

    if (body.op === "read") return await signRead(blobs, caller, body);
    if (body.op === "write") return await signWrite(blobs, caller, body);
    if (body.op === "delete") return await removeBlobs(blobs, caller, body);
    throw new QueryError("Unknown operation.");
  } catch (err) {
    if (err instanceof AuthError || err instanceof QueryError) {
      return { status: err.status, jsonBody: { error: { message: err.message } } };
    }
    (options.log ?? console.error)("blob endpoint failed:", err?.stack ?? err);
    return { status: 500, jsonBody: { error: { message: "Something went wrong." } } };
  }
}

async function signRead(blobs, caller, body) {
  const path = checkPath(body.path);

  /* THE PERMISSION CHECK, and it is a database query rather than a rule.
     Run as the caller, so the `attachments` policies answer it. */
  const visible = await asUser(caller.userId, async (client) => {
    const res = await client.query(
      "select 1 from public.attachments where path = $1 limit 1", [path]);
    return res.rowCount > 0;
  });

  /* Deliberately the same answer as for a file that does not exist. Telling
     the difference would turn this into a way to ask whether a given
     attachment path is real. */
  if (!visible) throw new QueryError("No such attachment.", 404);

  const url = await blobs.sign(path, "r", READ_SECONDS);
  return { status: 200, jsonBody: { url, expiresInSeconds: READ_SECONDS } };
}

async function signWrite(blobs, caller, body) {
  const path = checkPath(body.path);

  /* No row exists yet, so there is nothing for the policies to judge. This
     is the rule Supabase's storage policy enforced: your own folder only.
     Checked against the verified token — the request body does not get a
     say in whose folder it is writing to. */
  if (!ownsPath(path, caller.userId)) {
    throw new QueryError("You can only upload into your own folder.", 403);
  }

  /* Create-only, not write: `c` fails if the blob already exists, so an
     upload cannot overwrite bytes that are already there. The path carries
     a unique segment, so a collision would mean somebody else's file. */
  const url = await blobs.sign(path, "c", WRITE_SECONDS);
  return { status: 200, jsonBody: { url, expiresInSeconds: WRITE_SECONDS } };
}

async function removeBlobs(blobs, caller, body) {
  const paths = Array.isArray(body.paths) ? body.paths.map(checkPath) : [];
  if (paths.length === 0) return { status: 200, jsonBody: { removed: [] } };
  if (paths.length > MAX_PATHS) throw new QueryError("Too many paths.");

  /* Row first, inside the caller's transaction, so the policies decide
     which of these they may actually delete — then the bytes. If the store
     refuses, the throw rolls the transaction back and the rows come back
     with it. The old Supabase version deleted the object first and could
     leave a row pointing at nothing. */
  const removed = await asUser(caller.userId, async (client) => {
    const res = await client.query(
      "delete from public.attachments where path = any($1) returning path", [paths]);
    const gone = res.rows.map((r) => r.path);
    if (gone.length > 0) await blobs.remove(gone);
    return gone;
  });

  return { status: 200, jsonBody: { removed } };
}
