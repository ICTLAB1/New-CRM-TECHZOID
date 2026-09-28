/**
 * The Azure half of attachments, and nothing else.
 *
 * Kept apart from `blob.mjs` on purpose: everything worth testing — who may
 * read what, whose folder you may write into, what happens when a delete
 * half-fails — lives there and needs no Azure. This is the part that cannot
 * be tested without a real storage account, so it is made as small as it can
 * be and given no decisions to make.
 *
 * USER-DELEGATION SAS, NOT AN ACCOUNT KEY. The storage account has
 * shared-key access disabled outright (see infra/main.bicep), so an account
 * key does not exist to be stolen, logged, or checked into anything. The
 * signing key is fetched from Entra ID using the function app's managed
 * identity, lives an hour, and is renewed before it lapses.
 */

let cached = null;

/**
 * Build the client, or return null when storage is not configured.
 *
 * Null rather than throwing, so a deployment without attachments configured
 * answers "not configured" on the attachment endpoint and serves every other
 * request normally.
 */
export async function getBlobs(env = process.env) {
  if (cached) return cached;

  const account = env.ATTACHMENTS_ACCOUNT;
  const container = env.ATTACHMENTS_CONTAINER || "attachments";
  if (!account) return null;

  /* Imported here rather than at module scope so that the rest of the API
     runs on a deployment where these packages are not installed. */
  const { BlobServiceClient, generateBlobSASQueryParameters, SASProtocol, BlobSASPermissions } =
    await import("@azure/storage-blob");
  const { DefaultAzureCredential } = await import("@azure/identity");

  const url = `https://${account}.blob.core.windows.net`;
  const service = new BlobServiceClient(url, new DefaultAzureCredential());

  /* The delegation key is good for an hour and is shared by every request
     in that window. Fetching one per request would put an Entra ID round
     trip in front of every file a salesperson opens. */
  let key = null;
  let keyExpires = 0;
  async function delegationKey() {
    const now = Date.now();
    if (key && now < keyExpires - 60_000) return key;
    const start = new Date(now - 5 * 60_000);      // clock skew
    const end = new Date(now + 60 * 60_000);
    key = await service.getUserDelegationKey(start, end);
    keyExpires = end.getTime();
    return key;
  }

  cached = {
    /** A SAS URL for one blob. `permissions` is "r" to read, "c" to create. */
    async sign(path, permissions, seconds) {
      const signed = generateBlobSASQueryParameters({
        containerName: container,
        blobName: path,
        permissions: BlobSASPermissions.parse(permissions),
        startsOn: new Date(Date.now() - 5 * 60_000),
        expiresOn: new Date(Date.now() + seconds * 1000),
        /* HTTPS only: a SAS is a credential in a query string, and over
           plain HTTP it is a credential in cleartext. */
        protocol: SASProtocol.Https,
      }, await delegationKey(), account).toString();

      return `${url}/${container}/${encodeURI(path)}?${signed}`;
    },

    /** Delete blobs. Missing ones are not an error — the caller is tidying
     *  up, and a file already gone is the outcome it wanted. */
    async remove(paths) {
      const client = service.getContainerClient(container);
      await Promise.all(paths.map((p) =>
        client.getBlockBlobClient(p).deleteIfExists().catch((err) => {
          console.error("could not delete blob", p, err?.message ?? err);
          throw err;
        })));
    },
  };
  return cached;
}

/** Drop the cached client. For tests, and after a configuration change. */
export function forgetBlobs() {
  cached = null;
}
