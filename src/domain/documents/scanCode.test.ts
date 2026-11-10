import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { parseScan, scanMatrix, scanPayload } from "./scanCode";

describe("what the square carries", () => {
  it("is the document number, exactly as it is printed", () => {
    expect(scanPayload("TZ/QT/2026-27/0042")).toBe("TZ/QT/2026-27/0042");
    expect(scanPayload("  TZ/PI/2026-27/0007  ")).toBe("TZ/PI/2026-27/0007");
  });

  it("stays small enough to print at 18mm", () => {
    /* THE REASON A URL WAS NOT USED. A document number fits a 25-module
       square; the same number inside a URL needs 37 or more, which at
       18mm is a 0.45mm module — too fine to survive a photocopier.
       If this ever fails, the payload grew and the square must grow with
       it or the code stops scanning off paper. */
    for (const n of ["TZ/QT/2026-27/0042", "TZ/INV/2026-27/0001", "VX/PO/2026-27/0113"]) {
      expect(scanMatrix(n).length, n).toBeLessThanOrEqual(25);
    }
  });

  it("is a square grid with the finder patterns in three corners", () => {
    const m = scanMatrix("TZ/QT/2026-27/0042");
    expect(m.every((row) => row.length === m.length)).toBe(true);
    /* Every QR carries a 7x7 finder in three corners and none in the
       fourth: a dark 7x7 border, a light ring inside it, a dark 3x3
       core. Checking all three catches a matrix built transposed or
       upside down, which is how this goes wrong and is invisible by
       eye on a square that still looks like a QR code. */
    const n = m.length;
    const finderAt = (r0: number, c0: number) => {
      for (let i = 0; i < 7; i++) {
        expect(m[r0]![c0 + i], `top edge ${r0},${c0}`).toBe(true);
        expect(m[r0 + 6]![c0 + i], `bottom edge ${r0},${c0}`).toBe(true);
        expect(m[r0 + i]![c0], `left edge ${r0},${c0}`).toBe(true);
        expect(m[r0 + i]![c0 + 6], `right edge ${r0},${c0}`).toBe(true);
      }
      expect(m[r0 + 1]![c0 + 1], `ring ${r0},${c0}`).toBe(false);
      expect(m[r0 + 3]![c0 + 3], `core ${r0},${c0}`).toBe(true);
    };
    finderAt(0, 0);
    finderAt(0, n - 7);
    finderAt(n - 7, 0);
    /* And none in the bottom-right: that corner is data, so its 7x7
       border cannot be solid. */
    const bottomRightEdge = Array.from({ length: 7 }, (_, i) => m[n - 7]![n - 7 + i]);
    expect(bottomRightEdge.every(Boolean)).toBe(false);
  });

  it("gives the same square for the same number, every time", () => {
    /* A renderer, a preview and a test all have to agree on it. */
    expect(scanMatrix("TZ/QT/2026-27/0042")).toEqual(scanMatrix("TZ/QT/2026-27/0042"));
  });

  it("gives a different square for a different number", () => {
    expect(scanMatrix("TZ/QT/2026-27/0042")).not.toEqual(scanMatrix("TZ/QT/2026-27/0043"));
  });
});

describe("reading a code back", () => {
  it("reads the payload it printed", () => {
    expect(parseScan(scanPayload("TZ/QT/2026-27/0042"))).toBe("TZ/QT/2026-27/0042");
  });

  it("takes a number typed by hand, spaces and all", () => {
    /* The manual box exists for a document whose code is too creased to
       scan, which is exactly when somebody types carefully and puts
       spaces around the slashes. */
    expect(parseScan("TZ / QT / 2026-27 / 0042")).toBe("TZ/QT/2026-27/0042");
    expect(parseScan("TZ/QT/2026-27/0042.")).toBe("TZ/QT/2026-27/0042");
  });

  it("takes a URL form too, so a later version's codes still resolve", () => {
    expect(parseScan("https://crm.ttpldelhi.com/?doc=TZ%2FQT%2F2026-27%2F0042")).toBe("TZ/QT/2026-27/0042");
    expect(parseScan("https://crm.ttpldelhi.com/d/TZ%2FQT%2F2026-27%2F0042")).toBe("TZ/QT/2026-27/0042");
  });

  it("refuses what is not one of ours", () => {
    /* A camera pointed at a page finds whatever else is on it. A UPI
       string or a vCard must not be searched for as a document. */
    for (const junk of [
      "", "   ", null, undefined,
      "upi://pay?pa=someone@okaxis&am=100",
      "BEGIN:VCARD\nFN:Someone\nEND:VCARD",
      "https://example.com/nothing-here",
      "ab",
      "x".repeat(65),
    ]) {
      expect(parseScan(junk as string), String(junk)).toBeNull();
    }
  });

  it("is not fooled by a URL it cannot parse", () => {
    expect(parseScan("https://")).toBeNull();
  });
});

describe("a real reader reading it", () => {
  /**
   * THE ONLY TEST THAT PROVES THE SQUARE IS A QR CODE.
   *
   * Everything else here checks the shape of the grid. A grid can have
   * finder patterns in the right corners, the right size and the right
   * look, and still decode to nothing — a wrong mask, a miscomputed error
   * correction block — and no amount of staring at it would tell you.
   * So the matrix is painted into an image and read back by a decoder
   * that knows nothing about how it was made.
   *
   * The scale and the quiet zone are what the PDF prints: four white
   * modules around the square, which is what makes it findable at all.
   */
  const imageOf = (payload: string, scale = 4, quiet = 4) => {
    const m = scanMatrix(payload);
    const n = m.length;
    const side = (n + quiet * 2) * scale;
    const data = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!m[r]![c]) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const x = (c + quiet) * scale + dx;
            const yy = (r + quiet) * scale + dy;
            const i = (yy * side + x) * 4;
            data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
          }
        }
      }
    }
    return { data, side };
  };

  it("decodes back to the document number", () => {
    for (const number of ["TZ/QT/2026-27/0042", "TZ/INV/2026-27/0001", "VX/PO/2026-27/0113"]) {
      const { data, side } = imageOf(scanPayload(number));
      const read = jsQR(data, side, side);
      expect(read?.data, number).toBe(number);
    }
  });

  it("decodes what the scanner will then parse, end to end", () => {
    const number = "TZ/QT/2026-27/0042";
    const { data, side } = imageOf(scanPayload(number));
    expect(parseScan(jsQR(data, side, side)?.data)).toBe(number);
  });

  it("still decodes with a corner obscured, which is what a rubber stamp does", () => {
    /* Error correction M carries 15%. The bottom-right corner is data,
       not a finder, so losing a bite of it is survivable — and these
       documents get stamped. */
    const number = "TZ/QT/2026-27/0042";
    const { data, side } = imageOf(number);
    const bite = Math.floor(side * 0.12);
    for (let yy = side - bite; yy < side; yy++) {
      for (let x = side - bite; x < side; x++) {
        const i = (yy * side + x) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
      }
    }
    expect(jsQR(data, side, side)?.data).toBe(number);
  });
});
