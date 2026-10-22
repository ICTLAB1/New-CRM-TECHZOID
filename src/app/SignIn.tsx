import { useState } from "react";
import { Button, Card, Field, Input } from "../components/primitives";
import { sendPasswordReset, signIn, signInWithMicrosoft, usesMicrosoftSignIn } from "../data/session";

/**
 * Sign in.
 *
 * One card, two fields, and errors that say what to do next. It never says
 * whether the email exists — that distinction is only useful to somebody
 * working out which addresses are worth attacking.
 */

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      await signIn(email, password);
      /* Nothing to do on success: the session change reloads the app. */
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in.");
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(""); setSent(false);
    if (!email.trim()) {
      setError("Enter your email address first, then ask for the reset.");
      return;
    }
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that.");
    }
  };

  /* WHEN MICROSOFT SIGN-IN IS ON, THE PASSWORD FORM IS NOT SHOWN AT ALL.
     Not disabled, not hidden behind a tab — absent. Leaving it there would
     invite somebody to type a password that no longer signs anybody in, and
     then to conclude their account is broken. */
  if (usesMicrosoftSignIn()) {
    return (
      <main className="signin">
        <div className="signin-panel">
          <div className="signin-brand">
            <span className="brand-mark">TZ</span>
            <span className="brand-name">TechZoid</span>
          </div>

          <Card title="Sign in">
            <div className="stack">
              <p className="muted">Use your TechZoid Microsoft account.</p>
              <Button
                tone="primary"
                loading={busy}
                loadingLabel="Opening Microsoft…"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  signInWithMicrosoft()
                    .catch((err: unknown) => setError(
                      err instanceof Error ? err.message : "Microsoft sign-in did not complete."))
                    .finally(() => setBusy(false));
                }}
              >
                Sign in with Microsoft
              </Button>
              {error ? <p className="error">{error}</p> : null}
            </div>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="signin">
      <form className="signin-panel" onSubmit={(e) => void submit(e)}>
        <div className="signin-brand">
          <span className="brand-mark">TZ</span>
          <span className="brand-name">TechZoid</span>
        </div>

        <Card title="Sign in">
          <div className="stack">
            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
            {sent ? (
              <div className="notice notice-good">
                <span>If that address has an account, a reset link is on its way to it.</span>
              </div>
            ) : null}

            <Button loading={busy} loadingLabel="Signing in…" type="submit" tone="primary" disabled={busy || !email.trim() || !password}>
              Sign in
            </Button>

            <div className="spread wrap">
              <Button tone="quiet" size="sm" onClick={() => void reset()}>Forgot your password?</Button>
              <span className="field-hint">Accounts are created by an admin.</span>
            </div>
          </div>
        </Card>
      </form>
    </main>
  );
}

/**
 * Signed in with Microsoft, but the CRM could not load a profile.
 *
 * THIS SCREEN USED TO NAME A CAUSE IT DID NOT KNOW: "has no team record …
 * an admin can finish it from Settings → Team." When the team record exists
 * — which it did, for an Admin with two company memberships — the admin
 * opens Settings → Team, sees the person there, and has nowhere to go. A
 * stale Microsoft account from the previous sign-in directory produces the
 * same screen, and so does a profile that cannot be read.
 *
 * So it reports what actually failed when the server said, and otherwise
 * describes the state rather than guessing at the reason. Signing out is
 * offered first because it clears every cached Microsoft account, which is
 * the fix for the most common cause.
 */
export function NoProfile({ email, reason, onSignOut }: {
  email: string;
  reason?: string;
  onSignOut: () => void;
}) {
  return (
    <main className="signin">
      <div className="signin-panel">
        <Card title="Signed in, but the CRM could not load your profile">
          <div className="stack">
            <p style={{ margin: 0 }}>
              Microsoft signed <strong>{email}</strong> in, but the CRM could not match that to a
              team member.
            </p>
            {reason ? (
              <p style={{ margin: 0 }} className="muted">The server said: “{reason}”</p>
            ) : null}
            <p style={{ margin: 0 }} className="muted">
              Sign out and in again first — that clears a Microsoft account left over from the old
              sign-in directory, which is the usual cause. If it happens again, an admin should
              check this address is on the team in Settings → Team.
            </p>
            <Button tone="default" onClick={onSignOut}>Sign out</Button>
          </div>
        </Card>
      </div>
    </main>
  );
}
