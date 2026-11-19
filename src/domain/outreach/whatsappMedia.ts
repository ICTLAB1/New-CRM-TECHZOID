/**
 * What may be attached to a WhatsApp reply — the browser's copy.
 *
 * THE SERVER DECIDES. netlify/lib/whatsappMedia.mjs is the rule, and it
 * checks every request whether this file agrees or not: the browser can
 * be bypassed, so a check that only lives here is not a check. This exists
 * so the file picker offers the right files and a refusal arrives before
 * somebody waits through the upload of a file that was never going to be
 * accepted.
 *
 * KEPT IN STEP BY A TEST, not by anybody remembering. whatsappMedia.test
 * reads the server module and fails if the two lists or the two limits
 * drift — the same arrangement as the bulk-email pause, and for the same
 * reason: two copies of a rule is one copy and one lie waiting to happen.
 */

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png"] as const;

const DOCUMENT_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt",
] as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_CAPTION = 1024;

export const ALLOWED_EXTENSIONS: readonly string[] = [...IMAGE_EXTENSIONS, ...DOCUMENT_EXTENSIONS];

/** For the file input, so the picker shows the right files rather than
 *  everything followed by a refusal. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

const mb = (bytes: number): string => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

export function extensionOf(filename: string): string {
  const name = String(filename ?? "").trim();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Why this file cannot go, or "" when it can. The server says the same
 *  thing in the same words — see the test. */
export function whyFileRefused(filename: string, byteLength: number): string {
  const ext = extensionOf(filename);
  if (!ext) {
    return "That file has no extension, so there is no way to tell WhatsApp what it is. "
      + `Rename it with one of: ${ALLOWED_EXTENSIONS.join(", ")}.`;
  }

  const isImage = (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
  const isDocument = (DOCUMENT_EXTENSIONS as readonly string[]).includes(ext);
  if (!isImage && !isDocument) {
    return `WhatsApp will not take a .${ext} file from here. You can send: ${ALLOWED_EXTENSIONS.join(", ")}.`;
  }

  if (!byteLength) return "That file came through empty, so there was nothing to attach.";

  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
  if (byteLength > maxBytes) {
    return `That ${isImage ? "picture" : "file"} is ${mb(byteLength)}. `
      + `${isImage ? "Pictures" : "Files"} sent from here have to be under ${mb(maxBytes)}.`;
  }

  return "";
}

/** How big it is, for the chip beside the file's name. */
export const fileSizeLabel = (bytes: number): string =>
  bytes >= 1024 * 1024 ? mb(bytes) : `${Math.max(1, Math.round(bytes / 1024))} KB`;
