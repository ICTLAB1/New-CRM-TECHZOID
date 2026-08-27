import { useCallback, useEffect, useState } from "react";
import { ToastProvider } from "../components/Toast";
import { Button, Card } from "../components/primitives";
import { Workbench } from "./Workbench";
import { SignIn, NoProfile } from "./SignIn";
import { PublicLeadForm } from "../features/leads/PublicLeadForm";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { readLeadRef } from "../domain/leads/link";
import { useWorkspace, type WorkspaceData } from "../data/useWorkspace";
import { isConfigured, loadProfile, onSessionChange, signOut, type SignedInUser } from "../data/session";
import { CHALLANS, CUSTOMERS, ORDERS, INVOICES, PROFORMAS, PURCHASE_ORDERS, QUOTATIONS, SETTINGS, SUBSCRIPTIONS, USERS } from "./demoData";
import type { TeamMember } from "../features/team/TeamScreen";
import type { Session } from "@supabase/supabase-js";

/**
 * Which mode the app is in.
 *
 * With Supabase configured it signs in and works on the real workspace. With
 * it unconfigured — a preview build, a screenshot run, someone opening the
 * repo to look — it runs the same screens on fixtures, and says so at the top
 * of every page. There is deliberately no middle state where it looks live
 * and isn't.
 */

export function App() {
  /* /r/<code> — and the ?lead=<uuid> links already shared — are the public
     registration form: no sign-in, no shell, nothing of the CRM around it.
     Checked before anything else so a customer with the link never sees a
     sign-in screen. */
  const leadRef = readLeadRef(window.location);
  if (leadRef) {
    return (
      <ToastProvider>
        <ErrorBoundary where="the registration form">
          <PublicLeadForm refId={leadRef} />
        </ErrorBoundary>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      {/* Inside the toast provider, so a screen that crashed can still say
          something, and so the boundary catches the app rather than the
          provider that reports on it. */}
      <ErrorBoundary where="the CRM">
        {isConfigured() ? <LiveApp /> : <DemoApp />}
      </ErrorBoundary>
    </ToastProvider>
  );
}

/* ── live ──────────────────────────────────────────────────────────── */

type AuthState =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "no-profile"; email: string }
  | { status: "signed-in"; user: SignedInUser };

function LiveApp() {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });

  const resolve = useCallback(async (session: Session | null) => {
    if (!session) {
      setAuth({ status: "signed-out" });
      return;
    }
    const user = await loadProfile(session);
    setAuth(user
      ? { status: "signed-in", user }
      : { status: "no-profile", email: session.user.email ?? "your account" });
  }, []);

  useEffect(() => {
    /* onAuthStateChange fires immediately with the stored session, so this
       one subscription covers both the first load and every change after. */
    const unsubscribe = onSessionChange((session) => void resolve(session));
    return unsubscribe;
  }, [resolve]);

  if (auth.status === "checking") return <Splash message="Signing you in…" />;
  if (auth.status === "signed-out") return <SignIn />;
  if (auth.status === "no-profile") {
    return <NoProfile email={auth.email} onSignOut={() => void signOut()} />;
  }
  return <LiveWorkbench user={auth.user} />;
}

function LiveWorkbench({ user }: { user: SignedInUser }) {
  const ws = useWorkspace(true);

  if (ws.state === "loading") return <Splash message="Loading your workspace…" />;
  if (ws.state === "failed") {
    return (
      <Splash
        message={ws.error ?? "Something went wrong."}
        action={<Button tone="primary" onClick={() => void ws.reload()}>Try again</Button>}
      />
    );
  }

  const team: TeamMember[] = ws.profiles.map((p) => ({
    id: p.id, name: p.name, email: p.email, role: p.role, designation: p.designation,
  }));

  return (
    <Workbench
      data={ws.data}
      settings={ws.settings}
      team={team.length ? team : [{ id: user.id, name: user.name, email: user.email, role: user.role, designation: user.designation }]}
      user={user}
      onChange={ws.update}
      onSettingsChange={ws.updateSettings}
      onTeamChange={(next) => ws.setProfiles(next.map((m) => ({ ...m, email: m.email ?? "" })))}
      onRestore={(backup) => restore(backup, ws.data, ws.update, ws.settings, ws.updateSettings)}
      onSignOut={() => void signOut()}
      banner={ws.saveError ? (
        <div className="page-banner notice notice-bad">
          <span>{ws.saveError}</span>
          <Button size="sm" tone="quiet" onClick={ws.dismissSaveError}>Dismiss</Button>
        </div>
      ) : null}
    />
  );
}

/* ── demo ──────────────────────────────────────────────────────────── */

function DemoApp() {
  const [data, setData] = useState<WorkspaceData>({
    customers: CUSTOMERS,
    quotations: QUOTATIONS,
    proformas: PROFORMAS,
    purchaseOrders: PURCHASE_ORDERS,
    invoices: INVOICES,
    orders: ORDERS,
    challans: CHALLANS,
    subscriptions: SUBSCRIPTIONS,
  });
  const [settings, setSettings] = useState<Record<string, unknown>>(SETTINGS);
  const [team, setTeam] = useState<TeamMember[]>(USERS);

  const update = <K extends keyof WorkspaceData>(key: K, next: WorkspaceData[K]) =>
    setData((cur) => ({ ...cur, [key]: next }));

  return (
    <Workbench
      data={data}
      settings={settings}
      team={team}
      user={team[0] ?? USERS[0]!}
      onChange={update}
      onSettingsChange={setSettings}
      onTeamChange={setTeam}
      onRestore={(backup) => restore(backup, data, update, settings, setSettings)}
      banner={
        <div className="page-banner notice">
          <span>
            <strong>Preview.</strong> Sample records, and nothing behind them — no database, no email, no
            documents leaving this browser. Every screen is the real one.
          </span>
        </div>
      }
    />
  );
}

/* ── shared ────────────────────────────────────────────────────────── */

/**
 * Apply a backup file.
 *
 * One list at a time, each guarded: a backup written by an older version is
 * missing some of them, and a missing list must leave what is there alone
 * rather than emptying it.
 */
function restore(
  backup: Record<string, unknown>,
  data: WorkspaceData,
  update: <K extends keyof WorkspaceData>(key: K, next: WorkspaceData[K]) => void,
  settings: Record<string, unknown>,
  updateSettings: (next: Record<string, unknown>) => void,
): void {
  for (const key of Object.keys(data) as (keyof WorkspaceData)[]) {
    const list = backup[key];
    if (Array.isArray(list)) update(key, list as WorkspaceData[typeof key]);
  }
  if (backup["settings"] && typeof backup["settings"] === "object") {
    updateSettings({ ...settings, ...(backup["settings"] as Record<string, unknown>) });
  }
}

function Splash({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <main className="signin">
      <div className="signin-panel">
        <div className="signin-brand">
          <span className="brand-mark">TZ</span>
          <span className="brand-name">TechZoid</span>
        </div>
        <Card>
          <div className="stack">
            <p style={{ margin: 0 }}>{message}</p>
            {/* An indeterminate bar while there is nothing to act on. Once
                there is an action the wait has ended — showing both would
                say "still working" over a button asking you to retry. */}
            {action ? action : <div className="loading-bar" aria-hidden />}
          </div>
        </Card>
      </div>
    </main>
  );
}
