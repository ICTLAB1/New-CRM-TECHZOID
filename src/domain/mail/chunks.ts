/**
 * Splitting a file into the ranges Graph wants.
 *
 * Microsoft's rules, from the upload-session documentation: ranges go up in
 * order, each one at most 4 MB, and each PUT names its own bytes with a
 * `Content-Range: bytes {start}-{end}/{total}` header where end is
 * INCLUSIVE. Off by one there and the upload is rejected at the first chunk
 * or, worse, accepted with a gap.
 *
 * 3.75 MiB rather than 4 MB: it is a multiple of 320 KiB, which is the
 * boundary Microsoft's upload protocols are built around, and it stays
 * under 4 MB whether they mean 4,000,000 or 4,194,304.
 */
export const CHUNK_BYTES = 3_932_160;

export interface Chunk {
  start: number;
  /** Inclusive, as the Content-Range header requires. */
  end: number;
  /** What the header for this chunk must say. */
  contentRange: string;
  size: number;
}

export function chunksFor(total: number, chunkSize = CHUNK_BYTES): Chunk[] {
  const size = Math.max(1, Math.floor(chunkSize));
  const bytes = Math.max(0, Math.floor(total));
  if (bytes === 0) return [];

  const out: Chunk[] = [];
  for (let start = 0; start < bytes; start += size) {
    const end = Math.min(start + size, bytes) - 1;
    out.push({ start, end, size: end - start + 1, contentRange: `bytes ${start}-${end}/${bytes}` });
  }
  return out;
}

/** 0–100, for a progress bar that means something. */
export const percentDone = (uploaded: number, total: number): number =>
  total <= 0 ? 0 : Math.min(100, Math.round((uploaded / total) * 100));
