/**
 * The twenty-six Netlify functions, running on Azure unchanged.
 *
 * WHY A BRIDGE RATHER THAN TWENTY-SIX REWRITES. Every one of them exports
 * the same shape — `handler(event)` taking Netlify's v1 Lambda event and
 * returning `{ statusCode, headers, body }`. Azure's HttpRequest is
 * Fetch-shaped, which is a different shape but not a deeper one: the
 * translation is method, headers, query string, body, and back. Doing that
 * once, here, is a few dozen lines. Doing it twenty-six times by hand is a
 * few thousand, and between them these handlers are most of what the CRM
 * does that is not a screen — the follow-up sender, the campaign pacer, the
 * IndiaMART poller, the customer portal, the WhatsApp and email senders.
 * Each rewrite would be a chance to drop a check that nothing would catch.
 *
 * WHAT ACTUALLY CHANGED UNDERNEATH THEM is `netlify/lib/auth.mjs`:
 * `adminClient()` now returns the service client from `api/lib/serviceClient.mjs`
 * instead of a Supabase one, and `signedInUser()` verifies the bearer token
 * with `api/lib/identity.mjs` instead of asking Supabase Auth about it. The
 * handlers cannot tell, because the builder surface is the same one and a
 * verified user still has an `id`.
 *
 * THE ONE THAT DOES NOT COME ACROSS is `admin-users`, which calls Supabase's
 * user-management API to create, update and delete accounts. There is no
 * equivalent to port it to: user accounts are what moves to Entra ID, and
 * writing bcrypt hashes into `auth.users` in the meantime would be building
 * something to delete. It is listed below as unported rather than quietly
 * left out, and asking for it returns a plain 501 saying so.
 */

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/* api/src/functions -> api/netlify/functions, which is a symlink to the
   repository's own netlify/. `bridge.test.mjs` asserts it resolves, so a
   checkout that mangled the link fails the build rather than deploying an
   API with twenty-six routes missing. */
export const FUNCTIONS_DIR = join(here, "..", "..", "netlify", "functions");

/**
 * Handlers that need identity management and therefore wait for Entra ID.
 * Requested anyway, they answer 501 with a reason rather than 404, because
 * "not built yet" and "no such endpoint" are different problems for whoever
 * is reading the log.
 */
export const UNPORTED = {
  "admin-users":
    "User administration moves to Entra ID and is not available on this deployment yet.",
};

/**
 * Handlers Azure runs on a timer rather than on a request.
 *
 * The schedules are Netlify's, kept to the minute. Azure's NCRONTAB has a
 * SECONDS FIELD IN FRONT, which is the one difference that matters and the
 * one that would silently turn "every five minutes" into "every five
 * seconds" if it were copied across unchanged.
 */
export const SCHEDULED = {
  /* 04:00 UTC is 09:30 in India — a chaser should land at the start of a
     working day, not overnight. */
  "followups-run": "0 0 4 * * *",
  /* Every two minutes. The pacing lives in the rules, not in how often this
     runs, so running often makes a campaign responsive rather than faster. */
  "outreach-run": "0 */2 * * * *",
  /* Five minutes is IndiaMART's floor, not a preference: closer together
     earns 429, and more than five in a minute disables the key for fifteen. */
  "indiamart-pull": "0 */5 * * * *",
};

/** Every function file present, by name. */
export function functionNames(dir = FUNCTIONS_DIR) {
  /* A MISSING DIRECTORY IS EMPTY, NOT FATAL.
     `readdirSync` throws when the path is not there, and this runs at
     registration — inside the module the Functions host imports first. One
     throw here and the host registers NOTHING: not the bridged handlers it
     was looking for, and not `/api/q` either, which has nothing to do with
     any of this. The symptom is a function app that deploys cleanly,
     reports Running, and answers 404 to every route, with the reason
     visible only in a log this deployment could not reach.

     Which is exactly what happened: the deployment package was built
     excluding `netlify/`, and the whole API disappeared. The care taken a
     few lines down -- importing each handler on first CALL so that one bad
     module cannot take out the other twenty-five -- was undone by reading
     the directory eagerly. */
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (err) {
    console.warn(`No bridged functions at ${dir} (${err?.code ?? err}); registering none.`);
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"))
    .map((f) => f.replace(/\.mjs$/, ""))
    .sort();
}

/* -- the translation -------------------------------------------------- */

/**
 * An Azure HttpRequest as the Netlify v1 event the handlers expect.
 *
 * Headers are lowercased into a plain object because that is what Netlify
 * gave them and what they index into directly — `event.headers.authorization`
 * against a Headers instance is undefined, silently, and the handler decides
 * the caller is signed out.
 */
export async function toEvent(request) {
  const headers = {};
  if (request.headers?.forEach) {
    request.headers.forEach((value, key) => { headers[String(key).toLowerCase()] = value; });
  } else if (request.headers) {
    for (const [key, value] of Object.entries(request.headers)) {
      headers[String(key).toLowerCase()] = value;
    }
  }

  const url = new URL(request.url ?? "http://localhost/");
  const queryStringParameters = {};
  for (const [key, value] of url.searchParams.entries()) queryStringParameters[key] = value;

  /* A GET or HEAD has no body to read, and asking for one on some hosts
     throws rather than returning empty. */
  const method = String(request.method ?? "GET").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? null : await request.text();

  return {
    httpMethod: method,
    headers,
    body,
    queryStringParameters,
    path: url.pathname,
    rawUrl: url.toString(),
    isBase64Encoded: false,
  };
}

/** A Netlify v1 result as an Azure HttpResponseInit. */
export function toResponse(result) {
  if (!result || typeof result !== "object") {
    return { status: 500, jsonBody: { error: "The handler returned nothing." } };
  }
  return {
    status: result.statusCode ?? 200,
    headers: result.headers ?? {},
    /* `body` and not `jsonBody`: these handlers have already serialised, and
       some of them answer with HTML — the portal pages, the unsubscribe
       confirmation. Re-encoding would turn those into a quoted string. */
    body: result.body ?? "",
  };
}

/**
 * Wrap one handler module as an Azure handler.
 *
 * The module is imported on first call rather than at registration, so one
 * handler with a bad import does not stop the other twenty-five from being
 * registered — and the log says which one.
 */
export function bridge(name, dir = FUNCTIONS_DIR) {
  let loaded = null;

  return async function handle(request, context) {
    const refused = UNPORTED[name];
    if (refused) return { status: 501, jsonBody: { error: refused } };

    try {
      if (!loaded) loaded = await import(pathToFileURL(join(dir, `${name}.mjs`)).href);
      const event = await toEvent(request);
      return toResponse(await loaded.handler(event, context));
    } catch (err) {
      /* The handler's own errors are its business — it has already decided
         what to tell the caller. This is for the ones it did not catch, and
         the detail goes to the log, never into the body. */
      (context?.error ?? console.error)(`${name} failed:`, err?.stack ?? err);
      return { status: 500, jsonBody: { error: "Something went wrong." } };
    }
  };
}

/**
 * Register every function on a Functions app.
 *
 * `app` is passed in rather than imported so this can be tested without the
 * Functions host — see `bridge.test.mjs`.
 */
export function registerNetlifyFunctions(app, dir = FUNCTIONS_DIR) {
  const names = functionNames(dir);

  for (const name of names) {
    const schedule = SCHEDULED[name];
    if (schedule) {
      /* A scheduled function on Netlify was still an HTTP endpoint that
         Netlify called. Here the timer is the trigger, and there is no
         request — so it is handed one, with the method the handlers expect. */
      app.timer(name, {
        schedule,
        handler: (_timer, context) => bridge(name, dir)(
          { method: "POST", headers: {}, url: `http://timer/${name}`, text: async () => "{}" },
          context,
        ),
      });
      continue;
    }

    app.http(name, {
      methods: ["GET", "POST", "OPTIONS"],
      authLevel: "anonymous",
      route: name,
      handler: bridge(name, dir),
    });
  }

  return names;
}
