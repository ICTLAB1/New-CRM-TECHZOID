/**
 * The stored functions a browser may call, and nothing else.
 *
 * WHY THIS IS A WHITELIST AND NOT A LOOKUP. PostgREST exposed `/rpc/<name>`
 * for every function in the schema, and relied on Postgres privileges to
 * decide which ones answered. Reproducing that as "take the name from the
 * request and call it" would be a remote code execution hole with a public
 * door on it: `pg_read_file`, `pg_sleep`, every `SECURITY DEFINER` helper
 * the CRM has, and anything a future migration adds without anyone thinking
 * about it. The endpoint can call these eight and no others.
 *
 * AND WHY THE ARGUMENTS ARE WHITELISTED TOO. Each entry lists the exact
 * argument names the CRM actually sends. Argument names go into the SQL as
 * identifiers — that is what named notation means — so they cannot come from
 * the caller. Values are bound.
 *
 * EVERY ONE OF THESE IS `SECURITY DEFINER`, so each bypasses row-level
 * security internally and does its own check against `auth.uid()`. That
 * makes the identity stamped by `asUser` the only thing standing between a
 * caller and somebody else's document numbers. It is checked in
 * `identity.mjs` and it is checked before this file runs.
 *
 * DELIBERATELY ABSENT: `consume_rate_limit` and `may_manage_email_account`.
 * Both exist and both are called — by the scheduled jobs, which run as
 * `service_role` and do not come through here. A browser has no business
 * asking the database whether it has exhausted its own rate limit.
 */

export class RpcError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "RpcError";
    this.status = status;
  }
}

/**
 * name -> the signatures the CRM calls.
 *
 * `args` is the exact set of argument names, and a call must match one set
 * exactly. `returns: "rows"` means a set-returning function, which the
 * browser gets as an array; `"scalar"` means one value, which it gets bare —
 * the two shapes PostgREST produced, so no call site has to change.
 */
export const CALLABLE = {
  /* Creates a company and makes the caller its Admin. */
  create_company: [{ args: ["p_name"], returns: "scalar" }],

  /* Warns before a salesperson files a customer somebody else already has.
     Reads across owners, which is why it is SECURITY DEFINER, and returns
     only a reason and a name — never the other owner's records. */
  find_duplicate_customer: [{ args: ["p_company", "p_phone", "p_gstin"], returns: "rows" }],

  /* The caller's own referral code. */
  my_lead_code: [{ args: [], returns: "scalar" }],

  /* The sending accounts the caller may use. The `_safe` view exists so
     that credentials are not in what comes back. */
  my_sending_accounts: [{ args: [], returns: "rows" }],

  /* The next customer code in this company's series. */
  next_customer_code: [{ args: [], returns: "scalar" }],

  /* The next document number. Two signatures: the three-argument form
     numbers per company, the two-argument form is what a workspace that has
     not run migration 033 still calls. */
  next_doc_number: [
    { args: ["p_company", "p_obj_type", "p_fy"], returns: "scalar" },
    { args: ["p_obj_type", "p_fy"], returns: "scalar" },
  ],

  /* The next number in a named series — invoices, quotations, and so on. */
  next_doc_seq: [{ args: ["p_kind"], returns: "scalar" }],

  /* Rotates a webhook's signing secret and returns the new one.
     THE ONLY TIME THE SECRET IS EVER READABLE: it is stored hashed, so a
     caller that loses this response cannot ask for it again, only rotate
     again. The function checks for itself that the caller may manage the
     integration. */
  regenerate_webhook_secret: [{ args: ["p_kind"], returns: "scalar" }],
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Choose the signature this call matches, or refuse.
 *
 * Matching is on the exact set of argument names. A call carrying an extra
 * argument is refused rather than having it dropped: an argument the caller
 * thought was being applied and that silently was not is how a query comes
 * back with the wrong rows and nobody knows why.
 */
function signatureFor(fn, argNames) {
  const signatures = Object.prototype.hasOwnProperty.call(CALLABLE, fn) ? CALLABLE[fn] : null;
  if (!signatures) throw new RpcError("Unknown function.");

  const wanted = [...argNames].sort();
  for (const signature of signatures) {
    const have = [...signature.args].sort();
    if (have.length === wanted.length && have.every((a, i) => a === wanted[i])) return signature;
  }
  throw new RpcError(`Wrong arguments for ${fn}.`);
}

/**
 * Compile one call into parameterised SQL.
 *
 * Named notation (`p_kind => $1`) rather than positional, so a function with
 * defaults or overloads resolves the way the caller meant rather than the
 * way the argument order happened to fall.
 */
export function compileRpc(fn, args = {}) {
  if (typeof fn !== "string" || !IDENTIFIER.test(fn)) throw new RpcError("Unknown function.");
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new RpcError("Arguments must be an object.");
  }

  const names = Object.keys(args);
  const signature = signatureFor(fn, names);

  const params = [];
  /* The names come from `signature.args` — this file's own copy — not from
     the request. Iterating the whitelist rather than the caller's object is
     what keeps a caller-chosen string out of the identifier position. */
  const bindings = signature.args.map((name) => {
    params.push(args[name] === undefined ? null : args[name]);
    return `${name} => $${params.length}`;
  });

  const call = `public.${fn}(${bindings.join(", ")})`;
  const text = signature.returns === "rows"
    ? `select * from ${call}`
    : `select ${call} as value`;

  return { text, params, returns: signature.returns };
}

/**
 * Run one call on an already-identified connection.
 *
 * `client` comes from `asUser`/`asAnon` — never one this opens itself,
 * because a connection with nobody's identity on it is one these functions
 * cannot judge.
 */
export async function runRpc(client, call) {
  /* Takes an ALREADY-COMPILED call, not a name and arguments. Compiling is
     where the whitelist is applied and it is pure, so the endpoint does it
     before taking a connection — a flood of requests naming functions that
     do not exist then costs no transactions and cannot stall the callers
     asking for something real. Accepting a name here as well would put that
     check back inside the transaction for anyone who used the shorter form. */
  const { text, params, returns } = call;
  const result = await client.query(text, params);
  if (returns === "rows") return result.rows ?? [];
  /* A scalar comes back bare, as PostgREST returned it. A function that
     returned no row at all is `null`, not undefined, so the browser's
     `data ?? ""` fallbacks keep working. */
  return result.rows?.[0]?.value ?? null;
}
