/* Types for the server's media rules, so the browser's copy of them can be
   checked against this one in a test rather than by somebody remembering.
   See src/domain/outreach/whatsappMedia.ts. */
export declare const MAX_IMAGE_BYTES: number;
export declare const MAX_DOCUMENT_BYTES: number;
export declare const MAX_CAPTION: number;
export declare const ALLOWED_EXTENSIONS: string[];
export declare const ACCEPT_ATTRIBUTE: string;
export declare function extensionOf(filename: string): string;
export declare function mediaKindFor(filename: string, byteLength?: number):
  | { ok: true; kind: "image" | "document"; mimeType: string; maxBytes: number }
  | { ok: false; error: string };
