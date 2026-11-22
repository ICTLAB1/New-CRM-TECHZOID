import { useState, type ReactNode } from "react";
import { Button, Card, Field, Input } from "../components/primitives";
import { sendPasswordReset, signIn, signInWithMicrosoft, usesMicrosoftSignIn } from "../data/session";
import { COMPANY_LOCKUP_PATH } from "./brand";

/**
 * Sign in.
 *
 * Two fields, and errors that say what to do next. It never says whether
 * the email exists — that distinction is only useful to somebody working
 * out which addresses are worth attacking.
 *
 * TWO PANELS SINCE NOVEMBER 2026: the company on the left, the form on
 * the right. It was a 380px card floating on grey, which was correct and
 * looked like every other product. The left panel is the same near-black
 * and the same warm glow as the navigation rail, so signing in and
 * arriving are recognisably the same place. On a phone the panel is not
 * folded above the form — it is gone, because a screenful of brand
 * between somebody and the password field is a screenful they scroll
 * past every morning.
 */

/** The company side. One component, so the password form and the
 *  Microsoft form cannot drift into two different front doors. */
function Aside() {
  return (
    <aside className="signin-aside">
      <div className="signin-aside-logo">
        <img src={COMPANY_LOCKUP_PATH} alt="TechZoid Technologies" />
      </div>
      <div className="signin-aside-ink">
        <h1 className="signin-head">Everything about a deal, in one place.</h1>
        <p className="signin-sub">
          Quotations, proformas, invoices, orders and the conversations around them — for the
          whole team, on one screen.
        </p>
        <ul className="signin-points">
          {[
            "Quotations to invoices, without re-typing a line",
            "Follow-ups and payment reminders that send themselves",
            "WhatsApp and email against the customer's own record",
          ].map((line) => (
            <li key={line}>
              <span className="signin-tick" aria-hidden>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
              </span>
              {line}
            </li>
          ))}
        </ul>
      </div>
      <p className="signin-foot">TechZoid Technologies Private Limited</p>
      <div className="signin-glow" aria-hidden />
    </aside>
  );
}

/** The frame both forms sit in. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="signin">
      <Aside />
      <div className="signin-main">{children}</div>
    </main>
  );
}

/** Shown in place of the left panel on a phone, where that panel is not
 *  rendered at all — so the screen still says whose CRM this is. */
function MobileLogo() {
  return (
    <div className="signin-mobile-logo">
      <img src={COMPANY_LOCKUP_PATH} alt="TechZoid Technologies" />
    </div>
  );
}

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
      <Frame>
        <div className="signin-panel">
          <MobileLogo />
          <Card title="Welcome back">
            <p className="signin-welcome">Use your TechZoid Microsoft account.</p>
            <div className="stack">
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
              {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
            </div>
          </Card>
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      <form className="signin-panel" onSubmit={(e) => void submit(e)}>
        <MobileLogo />
        <Card title="Welcome back">
          <p className="signin-welcome">Sign in to your TechZoid CRM account.</p>
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
    </Frame>
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
    <Frame>
      <div className="signin-panel">
        <MobileLogo />
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
    </Frame>
  );
}
