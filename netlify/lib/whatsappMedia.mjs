/**
 * What may be attached to a WhatsApp reply, and as what.
 *
 * TWO KINDS OF MESSAGE, not one. Meta carries a photo as an `image`
 * message and everything else as a `document`. The difference is what the
 * customer sees: an image opens in the chat, a document arrives as a file
 * with its name on it. Sending a product photo as a document means the
 * customer taps a grey rectangle to find out what it is, so the kind is
 * decided here rather than left to whichever is easier to code.
 *
 * DECIDED BY EXTENSION, not by the browser's `type`. Browsers disagree
 * about office files — the same .xlsx arrives as
 * application/vnd.openxmlformats-officedocument.spreadsheetml.sheet from
 * one and application/octet-stream or an empty string from another — and a
 * reply refused because of which browser somebody opened the CRM in is not
 * something they could ever work out. The extension is what the person
 * sees in their own file list, so a refusal that names it is a refusal
 * they can act on. Meta is told the MIME type from this table, which is
 * also why the table and not the browser decides.
 *
 * THE SIZE LIMITS HERE ARE OURS AND ARE DELIBERATELY WELL UNDER META'S.
 * Meta's ceiling for a document is around a hundred megabytes, but the
 * file reaches the server base64-encoded inside a JSON body — about a
 * third larger than the file — and the eight megabytes allowed for a
 * quotation PDF has been the working limit of that path since it was
 * built. Images are held lower still: Meta is markedly stricter about
 * images than documents, and a photo straight off a phone that is refused
 * by Meta after a slow upload is worse than one refused here instantly.
 * Anything Meta refuses beyond these, it refuses in its own words, which
 * whatsappMeta passes through rather than paraphrasing.
 */

/** Sent as an `image` message: shown in the chat, not as a file. */
const IMAGES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** Sent as a `document` message: arrives as a named file. */
const DOCUMENTS = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** Meta's limit on the words that ride along with a file. Longer than this
 *  is not truncated — see whatsappSender: a message silently cut in half
 *  is worse than being asked to shorten it. */
export const MAX_CAPTION = 1024;

/** What a person should be offered in the file picker, and told in a
 *  refusal. Spelled the way they see them in their own file list. */
export const ALLOWED_EXTENSIONS = [...Object.keys(IMAGES), ...Object.keys(DOCUMENTS)];

/** The `accept` attribute for a file input, so the picker shows the right
 *  files rather than everything and a refusal afterwards. */
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

const mb = (bytes) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

export function extensionOf(filename) {
  const name = String(filename ?? "").trim();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Decide what this file is, or say why it cannot go.
 *
 * @returns {{ok: true, kind: "image"|"document", mimeType: string, maxBytes: number}
 *          | {ok: false, error: string}}
 */
export function mediaKindFor(filename, byteLength = 0) {
  const ext = extensionOf(filename);
  if (!ext) {
    return {
      ok: false,
      error: "That file has no extension, so there is no way to tell WhatsApp what it is. "
        + `Rename it with one of: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }

  const image = IMAGES[ext];
  const document = DOCUMENTS[ext];
  if (!image && !document) {
    return {
      ok: false,
      error: `WhatsApp will not take a .${ext} file from here. You can send: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }

  const kind = image ? "image" : "document";
  const maxBytes = image ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;

  if (!byteLength) {
    return { ok: false, error: "That file came through empty, so there was nothing to attach." };
  }
  if (byteLength > maxBytes) {
    return {
      ok: false,
      error: `That ${kind === "image" ? "picture" : "file"} is ${mb(byteLength)}. `
        + `${kind === "image" ? "Pictures" : "Files"} sent from here have to be under ${mb(maxBytes)}.`,
    };
  }

  return { ok: true, kind, mimeType: image || document, maxBytes };
}
