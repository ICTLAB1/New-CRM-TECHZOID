import { getDb, getFileStore, hasBackend } from "./backend";
import { StorageError } from "./storage";
import {
  checkFile, mimeFor, storagePath,
  type Attachment, type AttachableType,
} from "../domain/attachments/files";

/**
 * Uploading, listing and removing attached files.
 *
 * The only place in the app that touches a file store, whichever one is
 * configured — Supabase Storage or Azure Blob Storage, decided in
 * `backend.ts` and invisible from here. Two halves are always kept in step:
 * the BYTES, and the ROW in the `attachments` table saying what those bytes
 * are and what they belong to. A row without bytes is a broken download; bytes without a row are
 * invisible and never cleaned up — so `upload` deletes the object it just
 * wrote if the row fails to insert, and `remove` drops the row only after
 * the object is gone.
 *
 * Neither store is PUBLIC. Nothing here ever produces a permanent URL;
 * every read goes through a short-lived signed link issued to a signed-in
 * user whom the policies have agreed may see the row.
 */

/** How long a download link stays good. Long enough to click, short enough
 *  that a link pasted into a chat is not a lasting way in. */
const SIGNED_URL_SECONDS = 60 * 5;

export class AttachmentError extends Error {}

interface AttachmentRow {
  id: string;
  owner_id: string;
  uploaded_by_id: string | null;
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
  uploadedById: r.uploaded_by_id ?? "",
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
export const attachmentsAvailable = (): boolean => hasBackend();

/** Everything attached to one record, newest first. */
export async function listAttachments(
  recordType: AttachableType,
  recordId: string,
): Promise<Attachment[]> {
  const { data, error } = await getDb()
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
  /** Who owns the RECORD this hangs off. Kept for provenance; it is no
   *  longer who is allowed to touch the file. */
  ownerId: string;
  /** The signed-in user's id. This is what the storage path and the row's
   *  uploader are built from — anyone in the team may attach a file to
   *  anyone's record, but always as themselves. */
  uploaderId: string;
  uploadedBy: string;
  note?: string;
}): Promise<Attachment> {
  const { file, recordType, recordId, ownerId, uploaderId, uploadedBy, note = "" } = opts;

  const verdict = checkFile(file);
  if (!verdict.ok) throw new AttachmentError(verdict.reason ?? "That file can't be attached.");

  const store = getFileStore();
  /* The UPLOADER's folder, not the record owner's: both stores read the
     first path segment and reject anything written outside your own — the
     Supabase one in a bucket policy, the Azure one in `api/lib/blob.mjs`. */
  const path = storagePath(uploaderId, recordType, recordId, file.name, uid());
  const mime = mimeFor(file.name, file.type);

  try {
    await store.upload(path, file, mime);
  } catch (err) {
    throw new AttachmentError(err instanceof StorageError ? err.message : String(err));
  }

  const row: AttachmentRow = {
    id: uid(),
    owner_id: ownerId,
    uploaded_by_id: uploaderId,
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

  const { data, error } = await getDb()
    .from("attachments")
    .insert(row as unknown as Record<string, unknown>)
    .select()
    .single();
  if (error) {
    /* The bytes are up but nothing points at them. Take them back out rather
       than leaving an invisible file nobody will ever find to delete. */
    await store.remove([path]).catch(() => {});
    throw new AttachmentError(error.message);
  }
  return rowToAttachment(data as AttachmentRow);
}

/** A short-lived link to the bytes. Signed on demand — there is no permanent
 *  URL to leak, because neither store is public. */
export async function attachmentUrl(attachment: Attachment): Promise<string> {
  try {
    return await getFileStore().signedUrl(attachment.path, SIGNED_URL_SECONDS);
  } catch (err) {
    throw new AttachmentError(
      err instanceof StorageError ? err.message : "Couldn't open that file.");
  }
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
  try {
    await getFileStore().remove([attachment.path]);
  } catch (err) {
    throw new AttachmentError(err instanceof StorageError ? err.message : String(err));
  }
  const { error } = await getDb().from("attachments").delete().eq("id", attachment.id);
  if (error) throw new AttachmentError(error.message);
}

/**
 * Clear out everything attached to a record that is being deleted.
 *
 * The attachments table has no foreign key to the tables a file can hang
 * off, so nothing cascades — this is what stops a deleted quotation leaving
 * its files behind forever. Best-effort on purpose: failing to tidy up must
 * never be why a delete the user asked for does not happen.
 *
 * Now that anyone in the team can attach a file, a colleague's file on a
 * record you delete may survive this: the policies only let you remove what
 * you uploaded, unless you are an Admin or Manager. That is the right way
 * round — the tidy-up is untidy, rather than one person's delete quietly
 * destroying another's signed contract.
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
  await getFileStore().remove(rows.map((r) => r.path)).catch(() => {});
  await getDb().from("attachments").delete().in("id", rows.map((r) => r.id));
}
