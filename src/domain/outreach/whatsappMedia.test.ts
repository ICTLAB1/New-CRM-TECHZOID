import { describe, expect, it } from "vitest";
import {
  ACCEPT_ATTRIBUTE, ALLOWED_EXTENSIONS, MAX_CAPTION, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES,
  extensionOf, fileSizeLabel, whyFileRefused,
} from "./whatsappMedia";
import {
  ALLOWED_EXTENSIONS as SERVER_EXTENSIONS,
  ACCEPT_ATTRIBUTE as SERVER_ACCEPT,
  MAX_CAPTION as SERVER_CAPTION,
  MAX_DOCUMENT_BYTES as SERVER_DOCUMENT,
  MAX_IMAGE_BYTES as SERVER_IMAGE,
  mediaKindFor,
} from "../../../netlify/lib/whatsappMedia.mjs";

/**
 * Attaching a file to a WhatsApp reply.
 *
 * The rule lives on the server, because the browser can be bypassed. The
 * browser keeps a copy so the picker offers the right files and a refusal
 * does not wait for an upload. TWO COPIES OF A RULE IS ONE COPY AND ONE
 * LIE WAITING TO HAPPEN, so the first group here is the one that matters:
 * it fails the moment they drift.
 */

describe("the browser's copy against the server's", () => {
  it("allows exactly the same file types", () => {
    expect(ALLOWED_EXTENSIONS).toEqual(SERVER_EXTENSIONS);
  });

  it("offers the picker exactly the same list", () => {
    expect(ACCEPT_ATTRIBUTE).toBe(SERVER_ACCEPT);
  });

  it("holds the same limits", () => {
    expect(MAX_IMAGE_BYTES).toBe(SERVER_IMAGE);
    expect(MAX_DOCUMENT_BYTES).toBe(SERVER_DOCUMENT);
    expect(MAX_CAPTION).toBe(SERVER_CAPTION);
  });

  it("REFUSES THE SAME FILES IN THE SAME WORDS", () => {
    /* Not just the same verdict — the same sentence. A browser that says
       "too large" where the server says "WhatsApp will not take a .exe"
       sends somebody looking for the wrong problem. */
    const cases: [string, number][] = [
      ["quote.pdf", 1024],
      ["photo.jpg", 1024],
      ["photo.JPG", 1024],
      ["sheet.xlsx", 1024],
      ["virus.exe", 1024],
      ["archive.zip", 1024],
      ["noextension", 1024],
      ["trailing.", 1024],
      ["empty.pdf", 0],
      ["huge.pdf", MAX_DOCUMENT_BYTES + 1],
      ["huge.png", MAX_IMAGE_BYTES + 1],
      ["ok.png", MAX_IMAGE_BYTES],
    ];
    for (const [name, size] of cases) {
      const server = mediaKindFor(name, size);
      expect(whyFileRefused(name, size), name).toBe(server.ok ? "" : server.error);
    }
  });
});

describe("which files go", () => {
  it("takes the paperwork a reseller actually sends", () => {
    for (const name of ["Quotation_TZ-0311.pdf", "prices.xlsx", "spec.docx", "list.csv", "note.txt"]) {
      expect(whyFileRefused(name, 2048), name).toBe("");
    }
  });

  it("takes a photograph", () => {
    for (const name of ["rack.jpg", "serial.jpeg", "screenshot.png"]) {
      expect(whyFileRefused(name, 2048), name).toBe("");
    }
  });

  it("does not care how the extension was typed", () => {
    expect(whyFileRefused("INVOICE.PDF", 2048)).toBe("");
    expect(whyFileRefused("Photo.JPEG", 2048)).toBe("");
  });

  it("names what it will take when it refuses one", () => {
    /* A refusal that does not say what WOULD work makes somebody guess. */
    const why = whyFileRefused("setup.exe", 2048);
    expect(why).toContain(".exe");
    expect(why).toContain("pdf");
    expect(why).toContain("jpg");
  });
});

describe("how big is too big", () => {
  /* IMAGES ARE HELD LOWER THAN DOCUMENTS, deliberately: Meta is markedly
     stricter about images, and a photo straight off a phone refused by
     Meta after a slow upload is worse than one refused here at once. */
  it("allows a document up to its limit and not past it", () => {
    expect(whyFileRefused("big.pdf", MAX_DOCUMENT_BYTES)).toBe("");
    expect(whyFileRefused("big.pdf", MAX_DOCUMENT_BYTES + 1)).not.toBe("");
  });

  it("holds a picture to a smaller limit than a document", () => {
    expect(MAX_IMAGE_BYTES).toBeLessThan(MAX_DOCUMENT_BYTES);
    /* A size a PDF may be and a photograph may not. */
    const between = MAX_IMAGE_BYTES + 1;
    expect(whyFileRefused("fine.pdf", between)).toBe("");
    expect(whyFileRefused("toobig.jpg", between)).not.toBe("");
  });

  it("says how big it is and how big it may be", () => {
    const why = whyFileRefused("toobig.jpg", 9 * 1024 * 1024);
    expect(why).toContain("9 MB");
    expect(why).toContain("5 MB");
  });

  it("refuses an empty file rather than uploading nothing", () => {
    expect(whyFileRefused("empty.pdf", 0)).toContain("empty");
  });
});

describe("reading a filename", () => {
  it("finds the extension", () => {
    expect(extensionOf("a.pdf")).toBe("pdf");
    expect(extensionOf("two.dots.xlsx")).toBe("xlsx");
    expect(extensionOf("UPPER.PNG")).toBe("png");
  });

  it("finds none where there is none", () => {
    expect(extensionOf("plain")).toBe("");
    expect(extensionOf("trailing.")).toBe("");
    /* A dotfile is not an extension: ".env" is a name, not a type. */
    expect(extensionOf(".env")).toBe("");
  });
});

describe("the size shown beside the name", () => {
  it("reads in KB below a megabyte and MB above", () => {
    expect(fileSizeLabel(2048)).toBe("2 KB");
    expect(fileSizeLabel(2 * 1024 * 1024)).toBe("2 MB");
    expect(fileSizeLabel(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("never shows a real file as 0 KB", () => {
    /* A 40-byte file rounds to zero, and "0 KB" reads as nothing
       attached. */
    expect(fileSizeLabel(40)).toBe("1 KB");
  });
});
