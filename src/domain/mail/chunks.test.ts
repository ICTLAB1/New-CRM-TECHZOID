import { describe, expect, it } from "vitest";
import { chunksFor, percentDone, CHUNK_BYTES } from "./chunks";

describe("splitting a file into upload ranges", () => {
  it("covers every byte exactly once, with no gap and no overlap", () => {
    /* A gap is an upload Graph accepts and then cannot assemble; an overlap
       is one it rejects. Neither is visible by reading the code. */
    const total = CHUNK_BYTES * 3 + 517;
    const chunks = chunksFor(total);
    expect(chunks[0]?.start).toBe(0);
    expect(chunks[chunks.length - 1]?.end).toBe(total - 1);
    for (let i = 1; i < chunks.length; i += 1) {
      expect(chunks[i]!.start).toBe(chunks[i - 1]!.end + 1);
    }
    expect(chunks.reduce((n, c) => n + c.size, 0)).toBe(total);
  });

  it("ends each range on an INCLUSIVE byte, as Content-Range requires", () => {
    /* bytes 0-9/10 is ten bytes. bytes 0-10/10 is a rejected request. */
    const [first] = chunksFor(10, 10);
    expect(first?.contentRange).toBe("bytes 0-9/10");
    expect(first?.end).toBe(9);
  });

  it("keeps every chunk inside Microsoft's 4 MB ceiling", () => {
    for (const c of chunksFor(CHUNK_BYTES * 2 + 1)) {
      expect(c.size).toBeLessThanOrEqual(4 * 1024 * 1024);
    }
  });

  it("makes the last chunk the remainder, not a padded full one", () => {
    const chunks = chunksFor(25, 10);
    expect(chunks.map((c) => c.contentRange)).toEqual([
      "bytes 0-9/25", "bytes 10-19/25", "bytes 20-24/25",
    ]);
  });

  it("is one chunk for a file smaller than the chunk size", () => {
    expect(chunksFor(100, 1000)).toHaveLength(1);
    expect(chunksFor(100, 1000)[0]?.contentRange).toBe("bytes 0-99/100");
  });

  it("is nothing at all for an empty file", () => {
    expect(chunksFor(0)).toEqual([]);
  });

  it("reports progress without ever exceeding a hundred", () => {
    expect(percentDone(0, 100)).toBe(0);
    expect(percentDone(50, 100)).toBe(50);
    expect(percentDone(120, 100)).toBe(100);
    expect(percentDone(1, 0)).toBe(0);
  });
});
