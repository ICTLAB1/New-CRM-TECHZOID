import { useState, type ReactNode } from "react";
import { Button, Field, Input } from "../components/primitives";
import { sendPasswordReset, signIn, signInWithMicrosoft, usesMicrosoftSignIn } from "../data/session";
import { COMPANY_LOCKUP_PATH, MICROSOFT_MARK_PATH } from "./brand";
import { NavIcon } from "./NavIcon";

/**
 * Sign in.
 *
 * Two fields, and errors that say what to do next. It never says whether
 * the email exists — that distinction is only useful to somebody working
 * out which addresses are worth attacking.
 *
 * TWO PANELS: the company on the left, the form on the right. This is
 * the first screen anybody sees and it was a 380px card floating on grey
 * — correct, and indistinguishable from any other product's. The left
 * panel is the same near-black and the same warm glow as the navigation
 * rail, so signing in and arriving are recognisably the same place.
 *
 * BUILT TO THE COMPANY'S OWN REFERENCE (November 2026): an eyebrow over
 * a display headline, three named capabilities rather than a tick list,
 * and the form in a white card lifted off a grey ground with the three
 * things the CRM is for set under it.
 *
 * ON A PHONE THE LEFT PANEL IS GONE, not folded above the form. A
 * screenful of brand between somebody and the password field is a
 * screenful they scroll past every morning, and the keyboard then pushes
 * the field they are typing in off the bottom. The logo is in the card on
 * every width, so the phone still says whose CRM this is.
 */

/* ── the company side ──────────────────────────────────────────────── */

/** What the product does, as the reference states it. Three, because a
 *  fourth is the one nobody reads. */
const POINTS: { icon: string; title: string; detail: string }[] = [
  { icon: "quotations", title: "From Quote to Invoice", detail: "Manage the entire sales journey seamlessly" },
  { icon: "tasks", title: "Automated Follow-ups", detail: "Never miss a payment or opportunity" },
  { icon: "whatsapp", title: "Unified Communication", detail: "WhatsApp and email, linked to each customer" },
];

/**
 * The light trail across the foot of the dark panel.
 *
 * A FAN OF STROKES RATHER THAN A PICTURE. The reference has a bundle of
 * fine warm lines sweeping up from the bottom-left; as sixteen paths it
 * weighs nothing, scales to any panel and needs no file kept in step
 * with the palette — it is drawn in --brand, so it follows the brand
 * orange wherever that goes next.
 */
function Trail() {
  return (
    <svg className="signin-trail" viewBox="0 0 600 190" preserveAspectRatio="none"
      aria-hidden="true" focusable="false">
      {/* IT STAYS LOW UNTIL THE TEXT HAS ENDED. The first version swept up
          from a third of the way across and crossed the feature list, which
          read as a scribble over the words rather than as something behind
          them. The rise is held back to about 70% of the width — past the
          475px the ink block is allowed — and only then climbs. */}
      {Array.from({ length: 16 }, (_, i) => {
        const k = i / 15;
        const y0 = 186 - k * 34;
        const y1 = 120 - k * 44;
        const y2 = 50 - k * 36;
        return (
          <path
            key={i}
            d={`M-10 ${y0} C 200 ${y0 - 4}, 330 ${y0 - 18}, 430 ${y1} S 560 ${y2}, 620 ${y2 - 18}`}
            fill="none" stroke="var(--brand)" strokeWidth="0.9"
            opacity={(0.5 - k * 0.38).toFixed(3)}
          />
        );
      })}
    </svg>
  );
}

/** The company side. One component, so the password form and the
 *  Microsoft form cannot drift into two different front doors. */
function Aside() {
  return (
    <aside className="signin-aside">
      {/* The lockup is black artwork, so it gets the white ground it was
          drawn for — the same decision as the navigation rail, and the
          reason is in public/brand/README.md. */}
      <div className="signin-aside-logo">
        <img src={COMPANY_LOCKUP_PATH} alt="TechZoid Technologies" />
      </div>

      <div className="signin-aside-ink">
        <p className="signin-eyebrow"><span className="signin-eyebrow-rule" aria-hidden="true" />Sales CRM</p>
        <h1 className="signin-head">Everything about a deal, in one place.</h1>
        <p className="signin-sub">
          Quotations, proformas, invoices, orders and the conversations around them — for the
          whole team, on one screen.
        </p>
        <ul className="signin-points">
          {POINTS.map((p) => (
            <li key={p.title}>
              <span className="signin-point-icon" aria-hidden="true"><NavIcon id={p.icon} /></span>
              <span className="signin-point-ink">
                <strong>{p.title}</strong>
                <span>{p.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="signin-foot">TechZoid Technologies Private Limited</p>
      <div className="signin-glow" aria-hidden="true" />
      <Trail />
    </aside>
  );
}

/* ── the form side ─────────────────────────────────────────────────── */

/** What the CRM is for, under the form. Decoration that happens to be
 *  true: these three are the screens somebody lands on after signing in. */
function Uses() {
  return (
    <ul className="signin-uses" aria-hidden="true">
      {[["reports", "Manage Sales"], ["team", "Track Pipeline"], ["activity", "Grow Revenue"]].map(([icon, label]) => (
        <li key={label}>
          <span className="signin-use-icon"><NavIcon id={icon!} /></span>
          {label}
        </li>
      ))}
    </ul>
  );
}

/** The frame both forms sit in. */
function Frame({ children, uses = false }: { children: ReactNode; uses?: boolean }) {
  return (
    <main className="signin">
      <Aside />
      <div className="signin-main">
        <div className="signin-card">
          <div className="signin-card-logo">
            <img src={COMPANY_LOCKUP_PATH} alt="TechZoid Technologies" />
          </div>
          {children}
          {uses ? <Uses /> : null}
        </div>
      </div>
    </main>
  );
}

/** The arrow on the primary button. */
function Arrow() {
  return (
    <svg className="signin-go-arrow" width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
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
      <Frame uses>
        <h2 className="signin-title">Welcome back</h2>
        <p className="signin-welcome">Sign in to access your TechZoid Sales CRM</p>
        <div className="stack">
          <Button
            tone="primary"
            className="signin-go"
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
            {/* Microsoft's own mark, cropped from the artwork they supply.
                Never redrawn — see public/brand/README.md. It keeps the
                white ground it was drawn for. */}
            <span className="signin-ms-mark" aria-hidden="true">
              <img src={MICROSOFT_MARK_PATH} alt="" />
            </span>
            Sign in with Microsoft
            <Arrow />
          </Button>
          {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
          <p className="signin-note">Use your TechZoid Microsoft account.</p>
        </div>
      </Frame>
    );
  }

  return (
    <Frame uses>
      <h2 className="signin-title">Welcome back</h2>
      <p className="signin-welcome">Sign in to access your TechZoid Sales CRM</p>
      <form onSubmit={(e) => void submit(e)}>
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

          <Button className="signin-go" loading={busy} loadingLabel="Signing in…" type="submit" tone="primary" disabled={busy || !email.trim() || !password}>
            Sign in
            <Arrow />
          </Button>

          <div className="spread wrap">
            <Button tone="quiet" size="sm" onClick={() => void reset()}>Forgot your password?</Button>
            <span className="field-hint">Accounts are created by an admin.</span>
          </div>
        </div>
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
 *
 * IT CARRIES NO "WHAT THE CRM IS FOR" STRIP. Somebody is reading this
 * because they cannot get in; three reasons to want to is the wrong thing
 * to put under it.
 */
export function NoProfile({ email, reason, onSignOut }: {
  email: string;
  reason?: string;
  onSignOut: () => void;
}) {
  return (
    <Frame>
      <h2 className="signin-title">Signed in, but the CRM could not load your profile</h2>
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
    </Frame>
  );
}
