import { describe, expect, it } from "vitest";
import {
  ALLOWED_TYPES, MAX_ATTACHMENT_BYTES, checkFile, extensionOf, formatBytes, isPreviewable,
  mimeFor, safeName, sortAttachments, storagePath, totalBytes, type Attachment,
} from "./files";

/**
 * Attachments are the one place a user hands the product an arbitrary file
 * and an arbitrary name. Everything here pins what happens to that name
 * before it reaches a storage path, and what gets refused before an upload
 * is even attempted.
 */

describe("extensions", () => {
  it("reads the last extension, lower-cased", () => {
    expect(extensionOf("Quotation.PDF")).toBe("pdf");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
  });

  it("treats a leading dot as a hidden file, not an extension", () => {
    // Otherwise ".env" would pass the allow-list as type "env".
    expect(extensionOf(".env")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });

  it("returns nothing when there is no extension at all", () => {
    expect(extensionOf("README")).toBe("");
    expect(extensionOf("")).toBe("");
  });

  it("ignores directories in the name", () => {
    expect(extensionOf("C:\\Users\\raj\\po.pdf")).toBe("pdf");
    expect(extensionOf("/home/raj/po.pdf")).toBe("pdf");
  });
});

describe("what may be attached", () => {
  const ok = (name: string, size = 1000) => checkFile({ name, size });

  it("accepts the everyday business file types", () => {
    for (const ext of ["pdf", "png", "jpg", "docx", "xlsx", "csv"]) {
      expect(ok("file." + ext).ok, ext).toBe(true);
    }
  });

  it("refuses an executable, and says what is allowed", () => {
    const r = ok("payload.exe");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("pdf");
  });

  it("refuses a file with no extension — there is no telling what it is", () => {
    expect(ok("invoice").ok).toBe(false);
  });

  it("decides on the extension, never on a browser-reported type", () => {
    // A browser calls .docx "application/zip" and .exe "octet-stream".
    // Trusting it would refuse real documents and admit real executables.
    expect(ok("contract.docx").ok).toBe(true);
    expect(ok("contract.docx.exe").ok).toBe(false);
  });

  it("refuses an empty file", () => {
    expect(ok("empty.pdf", 0).ok).toBe(false);
  });

  it("accepts a file exactly on the limit and refuses one byte over", () => {
    expect(ok("big.pdf", MAX_ATTACHMENT_BYTES).ok).toBe(true);
    const over = ok("big.pdf", MAX_ATTACHMENT_BYTES + 1);
    expect(over.ok).toBe(false);
    expect(over.reason).toContain("25 MB");
  });

  it("names a size in the refusal, so the fix is obvious", () => {
    expect(ok("huge.pdf", 40 * 1024 * 1024).reason).toContain("40 MB");
  });
});

describe("the stored MIME", () => {
  it("comes from the extension rather than from the browser", () => {
    expect(mimeFor("sheet.xlsx", "application/zip")).toBe(ALLOWED_TYPES["xlsx"]);
  });

  it("falls back to what was reported for anything unrecognised", () => {
    expect(mimeFor("thing.unknown", "application/octet-stream")).toBe("application/octet-stream");
  });
});

describe("sanitising a filename", () => {
  it("keeps an ordinary name intact", () => {
    expect(safeName("Purchase_Order-2026.pdf")).toBe("Purchase_Order-2026.pdf");
  });

  it("replaces spaces and punctuation", () => {
    expect(safeName("PO for Acme (final).pdf")).toBe("PO-for-Acme-final-.pdf");
  });

  it("flattens traversal rather than trusting the bucket to reject it", () => {
    const out = safeName("../../etc/passwd");
    expect(out).not.toContain("..");
    expect(out).not.toContain("/");
    expect(out).toBe("passwd");
  });

  it("strips directories, keeping only the file", () => {
    expect(safeName("C:\\Users\\raj\\po.pdf")).toBe("po.pdf");
  });

  it("never returns an empty string", () => {
    // A path ending in a slash is not a file.
    expect(safeName("！！！")).toBe("file");
    expect(safeName("")).toBe("file");
    expect(safeName("...")).toBe("file");
  });

  it("caps the length", () => {
    expect(safeName("a".repeat(400) + ".pdf").length).toBeLessThanOrEqual(120);
  });

  it("does not leave a leading dot, which would hide the file", () => {
    expect(safeName(".hidden.pdf").startsWith(".")).toBe(false);
  });
});

describe("where the bytes go", () => {
  const OWNER = "11111111-2222-3333-4444-555555555555";

  it("puts the owner first, because the storage policy reads that segment", () => {
    const p = storagePath(OWNER, "quotation", "q1", "quote.pdf", "abc123");
    expect(p.split("/")[0]).toBe(OWNER);
    expect(p).toBe(`${OWNER}/quotation/q1/abc123-quote.pdf`);
  });

  it("sanitises the filename on the way into the path", () => {
    const p = storagePath(OWNER, "customer", "c1", "../../../etc/passwd", "u1");
    expect(p).toBe(`${OWNER}/customer/c1/u1-passwd`);
    expect(p.split("/")).toHaveLength(4);
  });

  it("gives two uploads of the same name different paths", () => {
    // Same path would mean the second upload silently replaces the first.
    const a = storagePath(OWNER, "invoice", "i1", "scan.pdf", "one");
    const b = storagePath(OWNER, "invoice", "i1", "scan.pdf", "two");
    expect(a).not.toBe(b);
  });
});

describe("sizes as people read them", () => {
  it("shows bytes below a kilobyte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("steps up through the units", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3 GB");
  });

  it("drops the decimal once the number is big enough not to need it", () => {
    expect(formatBytes(15.7 * 1024 * 1024)).toBe("16 MB");
  });

  it("never renders NaN for junk", () => {
    expect(formatBytes(Number("x"))).toBe("0 B");
  });
});

describe("previewing", () => {
  it("previews images and PDFs, downloads everything else", () => {
    expect(isPreviewable("image/png")).toBe(true);
    expect(isPreviewable("application/pdf")).toBe(true);
    expect(isPreviewable(ALLOWED_TYPES["xlsx"]!)).toBe(false);
  });
});

describe("listing", () => {
  const at = (over: Partial<Attachment>): Attachment => ({
    id: "a", ownerId: "u1", recordType: "customer", recordId: "c1",
    path: "p", name: "file.pdf", mime: "application/pdf", size: 100,
    uploadedBy: "Raj", createdAt: "2026-08-01T00:00:00Z",
    ...over,
  });

  it("puts the newest file first — it is the one being looked for", () => {
    const rows = sortAttachments([
      at({ id: "old", createdAt: "2026-01-01T00:00:00Z" }),
      at({ id: "new", createdAt: "2026-08-20T00:00:00Z" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("breaks ties by name so the order never wobbles between renders", () => {
    const rows = sortAttachments([
      at({ id: "b", name: "zeta.pdf" }),
      at({ id: "a", name: "alpha.pdf" }),
    ]);
    expect(rows.map((r) => r.name)).toEqual(["alpha.pdf", "zeta.pdf"]);
  });

  it("does not mutate what it was given", () => {
    const input = [at({ id: "a", createdAt: "2026-01-01T00:00:00Z" }), at({ id: "b" })];
    sortAttachments(input);
    expect(input.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("totals sizes, ignoring junk rather than producing NaN", () => {
    expect(totalBytes([at({ size: 100 }), at({ size: 250 })])).toBe(350);
    expect(totalBytes([at({ size: Number("x") })])).toBe(0);
    expect(totalBytes([])).toBe(0);
  });
});
