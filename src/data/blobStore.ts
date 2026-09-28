import type { FileStore } from "./storage";
import { StorageError } from "./storage";
import type { TokenSource } from "./apiClient";

/**
 * Attachments on Azure Blob Storage.
 *
 * THE BYTES DO NOT GO THROUGH THE API. The browser asks `/api/blob` for a
 * short-lived signed URL scoped to one blob, and then talks to Azure
 * directly. A 20MB contract uploaded through a Function would be 20MB into
 * the function and 20MB out of it, on a plan billed by the second, for no
 * benefit — the permission decision is the part that needs a server, and
 * that is exactly the part that stays there.
 *
 * WHAT THE SERVER DECIDES, AND WHY IT IS NOT DECIDED HERE. Nothing in this
 * file is a security boundary. A browser can call `/api/blob` with any path
 * it likes; the endpoint looks the attachment row up AS THE CALLER, so the
 * same row-level-security policies that decide whether somebody may see an
 * attachment in a list decide whether they may open it. See `api/lib/blob.mjs`.
 */

interface SignedUrl {
  url: string;
  expiresInSeconds: number;
}

export function createBlobStore(
  endpoint: string,
  getToken: TokenSource,
  doFetch: typeof fetch = fetch,
): FileStore {
  async function ask(body: Record<string, unknown>): Promise<SignedUrl & { removed?: string[] }> {
    const token = await getToken();
    if (!token) throw new StorageError("Sign in to use attachments.");

    const res = await doFetch(`${endpoint}/blob`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    let payload: { url?: string; expiresInSeconds?: number; removed?: string[]; error?: { message: string } };
    try {
      payload = await res.json();
    } catch {
      throw new StorageError(`The attachment service answered ${res.status}.`);
    }
    if (!res.ok || payload.error) {
      throw new StorageError(payload.error?.message ?? `The attachment service answered ${res.status}.`);
    }
    return payload as SignedUrl & { removed?: string[] };
  }

  return {
    async upload(path, file, mime) {
      const { url } = await ask({ op: "write", path });

      const res = await doFetch(url, {
        method: "PUT",
        headers: {
          /* Azure requires this on every block-blob PUT and rejects the
             request without it. Not optional, and not a default. */
          "x-ms-blob-type": "BlockBlob",
          "content-type": mime,
        },
        body: file,
      });

      if (!res.ok) {
        /* 409 is the create-only permission doing its job: something is
           already at this path. The path carries a unique segment, so that
           means a collision with somebody else's file, not a retry. */
        if (res.status === 409) throw new StorageError("A file already exists at that path.");
        throw new StorageError(`The upload failed (${res.status}).`);
      }
    },

    async signedUrl(path) {
      /* The lifetime is the server's to choose, not the caller's: a browser
         that could ask for a week-long link would be a browser that could
         mint one. The argument is accepted for interface compatibility and
         deliberately ignored. */
      const { url } = await ask({ op: "read", path });
      return url;
    },

    async remove(paths) {
      if (paths.length === 0) return;
      await ask({ op: "delete", paths });
    },
  };
}
