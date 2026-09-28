import type { FileStore } from "./storage";
import { StorageError } from "./storage";
import { getSupabase } from "./supabase";

/**
 * Attachments on Supabase Storage — what the CRM used before Azure, and
 * still uses on any deployment that has not moved.
 *
 * Lifted out of `attachments.ts` unchanged in behaviour. It is here rather
 * than inline so that the two stores sit side by side and the difference
 * between them is readable: the same three operations, one answering to
 * Supabase's bucket policies and one to an endpoint that asks the database.
 */

const BUCKET = "attachments";

export function createSupabaseStore(): FileStore {
  return {
    async upload(path, file, mime) {
      const { error } = await getSupabase().storage.from(BUCKET).upload(path, file, {
        contentType: mime,
        /* Never overwrite. The path already carries a unique segment, so an
           upsert here could only ever mean clobbering somebody else's bytes. */
        upsert: false,
      });
      if (error) throw new StorageError(error.message);
    },

    async signedUrl(path, seconds) {
      const { data, error } = await getSupabase()
        .storage.from(BUCKET).createSignedUrl(path, seconds);
      if (error || !data?.signedUrl) {
        throw new StorageError(error?.message ?? "Couldn't open that file.");
      }
      return data.signedUrl;
    },

    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await getSupabase().storage.from(BUCKET).remove(paths);
      if (error) throw new StorageError(error.message);
    },
  };
}
