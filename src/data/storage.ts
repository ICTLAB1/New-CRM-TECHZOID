/**
 * Where attached files live.
 *
 * Three operations, which is all the CRM has ever asked of a file store:
 * put these bytes somewhere, give me a link to them that expires, and take
 * them away again. Supabase Storage and Azure Blob Storage both do those
 * three, so this is the seam between them — and writing it out is what makes
 * `attachments.ts` stop caring which one is behind it.
 *
 * WHAT IS NOT HERE, DELIBERATELY: any notion of who may do these things.
 * A store that decided that would be a second place where permissions live,
 * and the second place is always the one that disagrees. Both
 * implementations answer to the `attachments` table's row-level-security
 * policies instead — Supabase's through its bucket policies, Azure's because
 * the endpoint that issues a signed URL looks the row up as the caller
 * first and hands back nothing if the policies do not show it to them.
 */

export interface FileStore {
  /**
   * Write bytes at `path`. Never overwrites: the path carries a unique
   * segment already, so a collision could only mean clobbering somebody
   * else's file.
   */
  upload(path: string, file: File, mime: string): Promise<void>;

  /**
   * A link to the bytes that stops working. There is no permanent URL to
   * leak, because neither store is public.
   */
  signedUrl(path: string, seconds: number): Promise<string>;

  /**
   * Remove files. Takes a list because deleting a record's attachments is
   * one operation, not one per file.
   *
   * Best-effort by contract: callers use it while tidying up, and failing
   * to tidy up must never be why a delete the user asked for does not
   * happen. A caller that needs to know can check what comes back.
   */
  remove(paths: string[]): Promise<void>;
}

export class StorageError extends Error {}
