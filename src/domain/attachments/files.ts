/**
 * What may be attached to a record, and where its bytes go.
 *
 * Pure: no upload, no network, no Supabase. Everything here is arithmetic on
 * a filename and a size, which is what lets the rules be tested exhaustively
 * rather than by trying uploads and seeing what bounces.
 *
 * The same limits are enforced in the database (see 010_attachments.sql).
 * These exist to tell somebody why a file was refused BEFORE they wait for
 * a 25 MB upload to fail — not instead of the server's rules. A limit only
 * the client applies is not a limit.
 */

/** 25 MB. Big enough for a scanned purchase order or a signed contract,
 *  small enough that nobody starts using the CRM as a file server. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Extension → MIME, and the allow-list in one place. Keyed by extension
 *  rather than by MIME because browsers disagree about what they report for
 *  the same file — Excel alone arrives under four different types. */
export const ALLOWED_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

/** What a file can be attached to. `order` is a sales order — the record a
 *  customer's own PO, delivery proof and acceptance note hang off. */
export type AttachableType =
  | "customer" | "order"
  | "quotation" | "proforma" | "purchase_order" | "invoice";

export interface Attachment {
  id: string;
  /** Who owns the RECORD this hangs off — not who uploaded the file. */
  ownerId: string;
  /** Who actually uploaded it. Anyone in the team may add a file, so this is
   *  what decides who may remove it again. Empty on files added before
   *  attachments became a team resource. */
  uploadedById?: string;
  recordType: AttachableType;
  recordId: string;
  /** Path inside the storage bucket. */
  path: string;
  /** The name the person who uploaded it saw, not the sanitised path. */
  name: string;
  mime: string;
  size: number;
  uploadedBy: string;
  note?: string;
  createdAt: string;
}

/** Lower-case extension without the dot, or "" when there isn't one. */
export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  /* A leading dot is a hidden file, not an extension: ".env" has no
     extension, and reading one would let it pass as a "env" type. */
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export interface FileCheck {
  ok: boolean;
  /** Why not, phrased for the person who picked the file. */
  reason?: string;
}

/**
 * May this file be attached?
 *
 * Type is decided by EXTENSION, not by the MIME the browser reports. A
 * browser will happily call an .exe "application/octet-stream" and a .docx
 * "application/zip"; the extension is what the operating system will act on
 * when somebody double-clicks the download, so it is what gets checked.
 */
export function checkFile(file: { name: string; size: number }): FileCheck {
  const ext = extensionOf(file.name);
  if (!ext) return { ok: false, reason: "That file has no extension, so there is no way to tell what it is." };
  if (!(ext in ALLOWED_TYPES)) {
    return { ok: false, reason: `.${ext} files can't be attached. Allowed: ${allowedExtensionList()}.` };
  }
  if (file.size <= 0) return { ok: false, reason: "That file is empty." };
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, reason: `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_ATTACHMENT_BYTES)}.` };
  }
  return { ok: true };
}

/** "pdf, png, jpg, …" — for telling somebody what they may attach. */
export const allowedExtensionList = (): string =>
  [...new Set(Object.keys(ALLOWED_TYPES))].join(", ");

/** The MIME to store, preferring the extension's known type over whatever
 *  the browser guessed. */
export const mimeFor = (filename: string, reported = ""): string =>
  ALLOWED_TYPES[extensionOf(filename)] ?? reported ?? "";

/**
 * Strip a filename down to something safe to put in a storage path.
 *
 * Everything that is not a letter, digit, dot, dash or underscore becomes a
 * dash, and `..` is flattened — a path segment is not a place to be relaxed
 * about traversal, even behind a bucket that would reject it.
 */
export function safeName(filename: string): string {
  const base = (filename.split(/[\\/]/).pop() ?? "").trim();
  const cleaned = base
    .replace(/\.{2,}/g, ".")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/-{2,}/g, "-");
  /* Never empty: a name made entirely of characters that got stripped would
     otherwise produce a path ending in a slash. */
  return cleaned.slice(0, 120) || "file";
}

/**
 * Where a file's bytes live.
 *
 * `<uploader-uuid>/<record-type>/<record-id>/<unique>-<name>` — the UPLOADER
 * first, because the storage policies decide from the first path segment
 * alone whether somebody may write there, without joining anything. Not the
 * record's owner: anyone in the team may attach a file to anyone's customer,
 * and they must still be writing inside their own folder.
 *
 * `unique` is supplied rather than generated, so a path is reproducible in a
 * test and this module keeps no source of randomness of its own.
 */
export function storagePath(
  uploaderId: string,
  recordType: AttachableType,
  recordId: string,
  filename: string,
  unique: string,
): string {
  return [uploaderId, recordType, recordId, `${unique}-${safeName(filename)}`].join("/");
}

/** "2.4 MB". Sizes are read at a glance, so bytes past three digits are
 *  noise — nobody needs to know a file is 2,458,112 bytes. */
export function formatBytes(bytes: number): string {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${Math.max(0, Math.round(n))} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/**
 * May this person remove this file?
 *
 * Adding is open to the whole team; removing is not. Deleting somebody
 * else's signed contract is not the kind of mistake a shared folder should
 * make easy, so it is the uploader or an Admin/Manager. Files predating
 * shared attachments carry no uploader, and fall back to the record's owner —
 * exactly who could delete them before.
 *
 * The database enforces the same rule. This exists so the button is hidden
 * rather than failing when pressed.
 */
export function canRemove(
  attachment: Attachment,
  user: { id: string; role?: string },
): boolean {
  if (user.role === "Admin" || user.role === "Manager") return true;
  if (attachment.uploadedById) return attachment.uploadedById === user.id;
  return attachment.ownerId === user.id;
}

/** True for the types worth previewing inline rather than downloading. */
export const isPreviewable = (mime: string): boolean =>
  mime.startsWith("image/") || mime === "application/pdf";

/** Newest first: the file somebody just added is the one they are looking
 *  for. Ties break on name so the order never wobbles between renders. */
export const sortAttachments = (rows: readonly Attachment[]): Attachment[] =>
  [...rows].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name));

/** Total bytes held against a record, for a "3 files · 4.1 MB" line. */
export const totalBytes = (rows: readonly Attachment[]): number =>
  rows.reduce((a, r) => a + (Number(r.size) || 0), 0);
