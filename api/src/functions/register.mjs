import { handleQuery, handleRpc } from "../../lib/http.mjs";
import { handleBlob } from "../../lib/blob.mjs";
import { getBlobs } from "../../lib/azureBlob.mjs";
import { handleAuthProxy } from "../../lib/authProxy.mjs";

/**
 * Wire the two endpoints onto a Functions app.
 *
 * Takes `app` as an argument rather than importing it, so the wiring can be
 * tested without the Functions host or the `@azure/functions` package —
 * which matters, because "the route is registered but points at the other
 * handler" is a bug that no unit test of either handler would notice and
 * that presents on the day of cutover as the CRM being unable to load.
 *
 * ON `authLevel: "anonymous"`. That is not "no authentication" — it means no
 * FUNCTION KEY. Authentication is the bearer token, checked in
 * `identity.mjs` against the identity provider's signature. A function key
 * would be a second shared secret, and the only place to put it would be in
 * the browser bundle, where it is not a secret at all. Anyone who reached
 * these endpoints without a valid token gets the `anon` role and sees
 * nothing, because that is what the policies say.
 */
export function register(app) {
  app.http("q", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "q",
    handler: (request) => handleQuery(request),
  });

  app.http("rpc", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "rpc",
    handler: (request) => handleRpc(request),
  });

  /* Attachments. The Azure client is resolved per request rather than at
     registration, so a deployment with no storage account configured still
     starts and still serves everything else — the endpoint answers "not
     configured" instead of the whole app failing to come up. */
  /* Sign-in, reached through this origin rather than from the browser.
     The office network answers NXDOMAIN for <ref>.supabase.co, so the
     browser cannot ask the identity provider anything; this app can. See
     `authProxy.mjs` for what it refuses to forward and why. */
  app.http("idp", {
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    authLevel: "anonymous",
    route: "idp/{*path}",
    handler: (request, context) =>
      handleAuthProxy(request, { path: request.params?.path, log: context?.error }),
  });

  app.http("blob", {
    methods: ["POST"],
    authLevel: "anonymous",
    route: "blob",
    handler: async (request) => handleBlob(request, { blobs: await getBlobs() }),
  });
}
