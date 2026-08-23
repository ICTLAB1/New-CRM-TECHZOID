/**
 * Reading the Microsoft 365 setup report.
 *
 * The wizard's job is to say which step is still outstanding, in order, and
 * nothing else. An admin working through seven steps in two browser tabs
 * needs "step 4 — the secret is wrong", not a wall of green ticks with one
 * red one somewhere in it.
 */

export interface SecretStatus {
  present: boolean;
  /** Last four characters at most, so an admin can tell the secret from the
   *  secret's ID. Never the value. */
  hint?: string | null;
  /** Only ever populated for MS_REDIRECT_URI, which is a public URL. */
  value?: string | null;
}

export interface Diagnostics {
  secrets: Record<string, SecretStatus>;
  checks: string[];
  table: { ready: boolean; error?: string | null };
  live: { checked: boolean; ok?: boolean; code?: string | null; message?: string };
}

export interface DiagnosticLine {
  ok: boolean;
  label: string;
  /** What to do about it. Absent when there is nothing to do. */
  detail?: string;
}

/** Which wizard step a missing piece belongs to, so the report can point at
 *  the step rather than at the variable name. */
const STEP_OF: Record<string, number> = {
  MS_CLIENT_ID: 5,
  MS_CLIENT_SECRET: 4,
  MS_TENANT_ID: 5,
  MS_REDIRECT_URI: 2,
  MS_STATE_SECRET: 5,
  RESEND_API_KEY: 5,
};

/** Set, but not required for Microsoft 365 to work. */
const OPTIONAL = new Set(["MS_TENANT_ID", "MS_STATE_SECRET", "RESEND_API_KEY"]);

export function diagnosticLines(diag: Diagnostics): DiagnosticLine[] {
  const lines: DiagnosticLine[] = [];

  for (const [name, status] of Object.entries(diag.secrets ?? {})) {
    const optional = OPTIONAL.has(name);
    lines.push({
      ok: status.present || optional,
      label: name,
      detail: status.present
        ? status.value ?? (status.hint ? `set (${status.hint})` : "set")
        : optional
          ? "not set — optional"
          : `not set in Netlify — step ${STEP_OF[name] ?? 5}`,
    });
  }

  lines.push({
    ok: diag.table?.ready ?? false,
    label: "Database table",
    detail: diag.table?.ready ? "ready" : "missing — run the migration in step 6",
  });

  if (diag.live?.checked) {
    lines.push({
      ok: diag.live.ok ?? false,
      label: "Microsoft credentials",
      detail: diag.live.message ?? (diag.live.ok ? "accepted" : "rejected"),
    });
  }

  return lines;
}

/**
 * The one thing to do next, or null when the setup is complete.
 *
 * Deliberately singular. Handing someone five simultaneous problems when
 * four of them are consequences of the first is how a setup screen becomes
 * something people give up on.
 */
export function nextAction(diag: Diagnostics): string | null {
  const missing = Object.entries(diag.secrets ?? {})
    .filter(([name, s]) => !s.present && !OPTIONAL.has(name))
    .map(([name]) => name);
  if (missing.length) {
    return `Add ${missing.join(", ")} in Netlify → Site configuration → Environment variables, then redeploy.`;
  }
  if (!diag.table?.ready) {
    return "Run supabase/003_ms_mail_accounts.sql in the Supabase SQL editor (step 6).";
  }
  if (diag.live?.checked && diag.live.ok === false) {
    return diag.live.message ?? "Microsoft rejected the credentials. Check the client ID and secret.";
  }
  if (diag.checks?.length) return diag.checks[0] ?? null;
  return null;
}

export const isReady = (diag: Diagnostics): boolean => nextAction(diag) === null;
