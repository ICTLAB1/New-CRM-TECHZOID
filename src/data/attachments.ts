import { getSupabase, isSupabaseConfigured } from "./supabase";
import {
  checkFile, mimeFor, storagePath,
  type Attachment, type AttachableType,
} from "../domain/attachments/files";

/**
 * Uploading, listing and removing attached files.
 *
 * The only place in the app that touches Supabase Storage. Two halves are
 * always kept in step: the BYTES in the `attachments` bucket, and the ROW in
 * the `attachments` table saying what those bytes are and what they belong
 * to. A row without bytes is a broken download; bytes without a row are
 * invisible and never cleaned up — so `upload` deletes the object it just
 * wrote if the row fails to insert, and `remove` drops the row only after
 * the object is gone.
 *
 * The bucket is PRIVATE. Nothing here ever produces a permanent URL; every
 * read goes through a short-lived signed link issued to a signed-in user.
 */

const BUCKET = "attachments";

/** How long a download link stays good. Long enough to click, short enough
 *  that a link pasted into a chat is not a lasting way in. */
const SIGNED_URL_SECONDS = 60 * 5;

export class AttachmentError extends Error {}

interface AttachmentRow {
  id: string;
  owner_id: string;
  record_type: string;
  record_id: string;
  path: string;
  name: string;
  mime: string;
  size: number;
  uploaded_by: string;
  note: string;
  created_at: string;
}

const rowToAttachment = (r: AttachmentRow): Attachment => ({
  id: r.id,
  ownerId: r.owner_id,
  recordType: r.record_type as AttachableType,
  recordId: r.record_id,
  path: r.path,
  name: r.name,
  mime: r.mime ?? "",
  size: Number(r.size) || 0,
  uploadedBy: r.uploaded_by ?? "",
  note: r.note ?? "",
  createdAt: r.created_at,
});

const uid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Attachments are a live-workspace feature: there is nowhere to put a file
 *  in demo mode, and pretending otherwise would lose somebody's document. */
export const attachmentsAvailable = (): boolean => isSupabaseConfigured();

/** Everything attached to one record, newest first. */
export async function listAttachments(
  recordType: AttachableType,
  recordId: string,
): Promise<Attachment[]> {
  const { data, error } = await getSupabase()
    .from("attachments")
    .select("*")
    .eq("record_type", recordType)
    .eq("record_id", recordId)
    .order("created_at", { ascending: false });
  if (error) throw new AttachmentError(error.message);
  return ((data as AttachmentRow[] | null) ?? []).map(rowToAttachment);
}

/**
 * Put a file against a record.
 *
 * `checkFile` runs first so an oversized or disallowed file is refused
 * immediately with a reason, rather than after somebody waits for 25 MB to
 * upload and be rejected by the bucket. The bucket enforces the same rules —
 * this is the courtesy, not the control.
 */
export async function uploadAttachment(opts: {
  file: File;
  recordType: AttachableType;
  recordId: string;
  ownerId: string;
  uploadedBy: string;
  note?: string;
}): Promise<Attachment> {
  const { file, recordType, recordId, ownerId, uploadedBy, note = "" } = opts;

  const verdict = checkFile(file);
  if (!verdict.ok) throw new AttachmentError(verdict.reason ?? "That file can't be attached.");

  const client = getSupabase();
  const path = storagePath(ownerId, recordType, recordId, file.name, uid());
  const mime = mimeFor(file.name, file.type);

  const up = await client.storage.from(BUCKET).upload(path, file, {
    contentType: mime,
    /* Never overwrite. The path already carries a unique segment, so an
       upsert here could only ever mean clobbering somebody else's bytes. */
    upsert: false,
  });
  if (up.error) throw new AttachmentError(up.error.message);

  const row: AttachmentRow = {
    id: uid(),
    owner_id: ownerId,
    record_type: recordType,
    record_id: recordId,
    path,
    name: file.name,
    mime,
    size: file.size,
    uploaded_by: uploadedBy,
    note,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await client.from("attachments").insert(row).select().single();
  if (error) {
    /* The bytes are up but nothing points at them. Take them back out rather
       than leaving an invisible file in the bucket that nobody will ever
       find to delete. */
    await client.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new AttachmentError(error.message);
  }
  return rowToAttachment(data as AttachmentRow);
}

/** A short-lived link to the bytes. Signed on demand — there is no permanent
 *  URL to leak, because the bucket is private. */
export async function attachmentUrl(attachment: Attachment): Promise<string> {
  const { data, error } = await getSupabase()
    .storage.from(BUCKET)
    .createSignedUrl(attachment.path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    throw new AttachmentError(error?.message ?? "Couldn't open that file.");
  }
  return data.signedUrl;
}

/**
 * Remove a file completely.
 *
 * Object first, then row. The other order can leave bytes nobody can see:
 * with the row gone there is no longer anything naming the path, so a failed
 * object delete would be unrecoverable. This way a failure leaves a row that
 * still points at a real file and can simply be deleted again.
 */
export async function removeAttachment(attachment: Attachment): Promise<void> {
  const client = getSupabase();
  const { error: storageError } = await client.storage.from(BUCKET).remove([attachment.path]);
  if (storageError) throw new AttachmentError(storageError.message);
  const { error } = await client.from("attachments").delete().eq("id", attachment.id);
  if (error) throw new AttachmentError(error.message);
}

/**
 * Clear out everything attached to a record that is being deleted.
 *
 * The attachments table has no foreign key to the five tables a file can
 * hang off, so nothing cascades — this is what stops a deleted quotation
 * leaving its files behind forever. Best-effort on purpose: failing to tidy
 * up must never be why a delete the user asked for does not happen.
 */
export async function removeAttachmentsFor(
  recordType: AttachableType,
  recordId: string,
): Promise<void> {
  /* Demo mode has no storage to clean up, and reaching for a client that
     was never configured would throw on a path whose whole job is to be
     harmless. */
  if (!attachmentsAvailable()) return;
  const rows = await listAttachments(recordType, recordId).catch(() => [] as Attachment[]);
  if (rows.length === 0) return;
  const client = getSupabase();
  await client.storage.from(BUCKET).remove(rows.map((r) => r.path)).catch(() => {});
  await client.from("attachments").delete().in("id", rows.map((r) => r.id));
}
