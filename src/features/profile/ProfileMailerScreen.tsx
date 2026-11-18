import { useEffect, useMemo, useRef, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Field, Input, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import {
  CHUNK, PROFILE_BODY, PROFILE_HERO, PROFILE_SUBJECT, messagesFor, profileCallToAction,
  recipientsFromCustomers, recipientsFromPaste,
  type ProfileDraft, type ProfileMessage,
} from "../../domain/outreach/profileMail";
import type { IntegrationsApi } from "../../integrations/api";
import { runPacedSend } from "../../domain/outreach/pacedSend";
import { audienceSummary, readPastedNumbers, whatsappAudience } from "../../domain/outreach/whatsappAudience";
import type { EmailCompany, EmailSender } from "../../domain/integrations/emailTemplate";
import { emailCompanyFrom } from "../../domain/integrations/emailIdentity";
import { emailProductGroups } from "../../domain/integrations/productLines";
import {
  MAX_PROFILE_BYTES, ProfileError, loadProfileFile, loadProfileInfo, loadRecentSends,
  saveProfile, type ProfileInfo,
} from "../../data/companyProfile";
import { suppressedAddresses } from "../../data/outreach";
import type { Customer } from "../../domain/customers/customer";

/**
 * Sending the company profile.
 *
 * WHAT THIS SCREEN PROMISES, in the line printed above the Send button and
 * kept by netlify/functions/profile-send.mjs: everybody gets their own
 * email. Thirty customers is thirty messages, each with one address in To
 * and that person's name in the greeting. Nobody can see who else it went
 * to, because as far as their inbox is concerned nobody else got it.
 *
 * THE PREVIEW IS THE MESSAGE. It is rendered from the same function the send
 * uses, for a named recipient, and the server sends what it is given — so
 * what is on screen is what arrives, not an impression of it. Flicking
 * through recipients in the preview is the only way to see that the
 * personalisation is right before thirty people do.
 *
 * WHY THERE IS NO SCHEDULE, NO THROTTLE AND NO UNSUBSCRIBE FOOTER. This is
 * not a campaign. A campaign writes to strangers from a purchased list over
 * nine days and needs all three (see features/outreach). This is a person
 * sending their own customers a document those customers asked about, with
 * their own reply-to on it. An unsubscribe footer on it would be the one
 * thing that made it read like bulk mail. What it does carry is the warning
 * below: if an address has opted out of campaigns, the screen says so and
 * leaves the decision to the person.
 */

export interface ProfileMailerScreenProps {
  api: IntegrationsApi;
  customers: Customer[];
  settings: Record<string, unknown>;
  user: { id: string; name: string; email?: string; designation?: string; phone?: string; role: string };
  companyId: string | null;
  /** Admin or Manager: only they may replace the file everybody sends. */
  canManageProfile: boolean;
  /** Customers ticked on the Customers screen before coming here. */
  preselected?: string[];
  /** Cleared once adopted, so coming back later does not re-select a list
   *  somebody chose days ago. */
  onDoneWithPreselection?: () => void;
}

const sizeOf = (bytes: number): string =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const when = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

export function ProfileMailerScreen({
  api, customers, settings, user, companyId, canManageProfile, preselected, onDoneWithPreselection,
}: ProfileMailerScreenProps) {
  const toast = useToast();

  const [chosen, setChosen] = useState<Set<string>>(new Set(preselected ?? []));
  const [query, setQuery] = useState("");
  const [pasted, setPasted] = useState("");
  const [subject, setSubject] = useState(PROFILE_SUBJECT);
  const [body, setBody] = useState(PROFILE_BODY);
  const [previewOf, setPreviewOf] = useState(0);

  /* ── the WhatsApp broadcast ───────────────────────────────────────
     Its own paste box, deliberately separate from the email one. The two
     lists are rarely the same people, and a number pasted into a box
     labelled "addresses" would be read as a lost address rather than a
     contact. */
  const [waPasted, setWaPasted] = useState("");
  const [waVouched, setWaVouched] = useState(false);
  const [waProgress, setWaProgress] = useState<{ done: number; total: number } | null>(null);
  const [waResults, setWaResults] = useState<Array<{ who: string; ok: boolean; error: string | null }>>([]);
  const [waStopped, setWaStopped] = useState("");

  const [info, setInfo] = useState<ProfileInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [optedOut, setOptedOut] = useState<ReadonlySet<string>>(new Set());
  const [alreadySent, setAlreadySent] = useState<Map<string, string>>(new Map());

  /* `waitingUntil` is a timestamp while the send is sitting out
     Microsoft's upload window — 0 the rest of the time. Held in the same
     object as the counts so the two can never disagree on screen. */
  const [progress, setProgress] = useState<
    { done: number; total: number; waitingUntil?: number } | null
  >(null);
  const [results, setResults] = useState<Array<{ email: string; label: string; ok: boolean; error: string | null }>>([]);
  const [stopped, setStopped] = useState("");

  /* Adopted once. The parent clears its own copy so this cannot re-run. */
  useEffect(() => {
    if (preselected?.length) {
      setChosen(new Set(preselected));
      onDoneWithPreselection?.();
    }
    /* eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival */
  }, []);

  useEffect(() => {
    let live = true;
    setLoadingInfo(true);
    void (async () => {
      const [profile, recent, suppressed] = await Promise.all([
        companyId ? loadProfileInfo(companyId) : Promise.resolve(null),
        companyId ? loadRecentSends(companyId) : Promise.resolve([]),
        suppressedAddresses().catch(() => new Set<string>()),
      ]);
      if (!live) return;
      setInfo(profile);
      setLoadingInfo(false);
      setOptedOut(suppressed);
      const seen = new Map<string, string>();
      for (const row of recent) if (row.status === "sent" && !seen.has(row.email)) seen.set(row.email, row.at);
      setAlreadySent(seen);
    })();
    return () => { live = false; };
  }, [companyId]);

  /* ── who it is from ────────────────────────────────────────────────── */

  const companySettings = (settings["company"] as Record<string, unknown> | undefined) ?? {};
  const companyName = String(companySettings["name"] ?? "");

  const sender: EmailSender = {
    name: user.name,
    email: user.email ?? "",
    phone: user.phone ?? "",
  };

  const company: EmailCompany = emailCompanyFrom(settings);

  const senderFields = {
    name: user.name,
    company: companyName,
    email: user.email ?? "",
    phone: user.phone ?? "",
    designation: user.designation ?? "",
  };

  /**
   * Send the profile on WhatsApp, to customers and to pasted numbers.
   *
   * SAME SHAPE AS THE EMAIL SEND and for the same reasons: in pieces, so a
   * function host cannot cut a long list in half with nothing to say which
   * of them went; and every answer recorded by name, so a list that half
   * worked is a list somebody can finish.
   */
  const sendOnWhatsApp = async () => {
    if (!companyId || !waTotal) return;
    setWaResults([]);
    setWaStopped("");
    setWaProgress({ done: 0, total: waTotal });

    const queue: Array<{ customerId?: string; phone?: string; label: string }> = [
      ...waFromCustomers.recipients.map((r) => ({ customerId: r.id, label: r.label })),
      ...waFromPaste.numbers.map((n) => ({ phone: n.number, label: n.label || n.number })),
    ];

    const collected: Array<{ who: string; ok: boolean; error: string | null }> = [];

    for (let i = 0; i < queue.length; i += CHUNK) {
      const piece = queue.slice(i, i + CHUNK);
      try {
        const res = await api.broadcastCompanyProfile({
          companyId,
          customerIds: piece.filter((p) => p.customerId).map((p) => p.customerId!),
          numbers: piece.filter((p) => p.phone).map((p) => ({ phone: p.phone!, label: p.label })),
          declaredConsent: waVouched,
        });
        for (const r of res.results) {
          const who = piece.find((p) => p.customerId === r.customerId || p.phone === r.phone)?.label
            ?? r.label ?? r.phone ?? r.customerId ?? "";
          collected.push({ who, ok: r.ok, error: r.error });
        }
      } catch (err) {
        /* The whole piece was refused — not signed in, no profile on file,
           the template not approved yet. The rest would be refused the
           same way. */
        setWaStopped(err instanceof Error && err.message ? err.message : "The broadcast stopped before it finished.");
        break;
      }
      setWaResults([...collected]);
      setWaProgress({ done: collected.length, total: waTotal });
    }

    setWaResults(collected);
    setWaProgress(null);

    const ok = collected.filter((r) => r.ok).length;
    if (ok && ok === collected.length) toast(`Sent to ${ok} on WhatsApp`, "good");
    else if (ok) toast(`${ok} sent, ${collected.length - ok} did not go — see the list`, "warn");
    else toast("Nothing was sent on WhatsApp", "bad");
  };

  /* ── who it goes to ────────────────────────────────────────────────── */

  const picked = useMemo(
    () => customers.filter((c) => chosen.has(c.id)),
    [customers, chosen],
  );

  /* WHO COULD ACTUALLY BE MESSAGED, out of the customers ticked above.
     Everybody else is shown with the reason rather than quietly left
     out — see domain/outreach/whatsappAudience.ts. */
  const waFromCustomers = useMemo(() => whatsappAudience(picked.map((c) => ({
    id: c.id, company: c.company, contact: c.contact,
    phone: c.phone, whatsappPhone: c.whatsappPhone, whatsappOptIn: c.whatsappOptIn,
  }))), [picked]);

  const waFromPaste = useMemo(() => readPastedNumbers(waPasted), [waPasted]);

  const waTotal = waFromCustomers.recipients.length + waFromPaste.numbers.length;

  const fromCustomers = useMemo(
    () => recipientsFromCustomers(picked, senderFields),
    [picked, senderFields.name, senderFields.company, senderFields.email, senderFields.phone, senderFields.designation],
  );

  const fromPaste = useMemo(
    () => recipientsFromPaste(pasted, senderFields, fromCustomers.recipients.map((r) => r.email)),
    [pasted, fromCustomers, senderFields.name, senderFields.company, senderFields.email, senderFields.phone, senderFields.designation],
  );

  const recipients = useMemo(
    () => [...fromCustomers.recipients, ...fromPaste.recipients],
    [fromCustomers, fromPaste],
  );

  const draft: ProfileDraft = {
    subject,
    body,
    sender,
    company,
    attachmentName: info?.fileName ?? "company-profile.pdf",
    /* The origin is this site, which is where the logos are served from.
       In a browser that is always known; the server never builds this
       draft, because the browser renders and the server only sends. */
    products: emailProductGroups(),
    hero: PROFILE_HERO,
    /* The reply goes to the person sending it, which is the whole point of
       sending one message per recipient. */
    callToAction: profileCallToAction(user.email ?? ""),
  };

  const messages = useMemo(() => messagesFor(draft, recipients), [subject, body, recipients, info?.fileName, companyName, user.name, user.designation, user.email, user.phone]);

  const preview: ProfileMessage | null = messages[Math.min(previewOf, Math.max(0, messages.length - 1))] ?? null;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? customers.filter((c) =>
          [c.company, c.contact, c.email, c.code].some((f) => String(f ?? "").toLowerCase().includes(q)))
      : customers;
    /* The ones already chosen stay visible at the top whatever the search
       says, or ticking a box and then typing makes the selection look lost. */
    return [...list].sort((a, b) => Number(chosen.has(b.id)) - Number(chosen.has(a.id)));
  }, [customers, query, chosen]);

  const toggle = (id: string) => {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setResults([]);
    setStopped("");
  };

  const chooseAllShown = () => {
    setChosen((prev) => {
      const next = new Set(prev);
      for (const c of matches) if (String(c.email ?? "").trim()) next.add(c.id);
      return next;
    });
  };

  /* ── the file everybody sends ──────────────────────────────────────── */

  const upload = async (file: File) => {
    if (!companyId) return;
    setUploading(true);
    try {
      setInfo(await saveProfile(companyId, file, user.id));
      toast("Company profile saved — every send attaches this file", "good");
    } catch (err) {
      toast(err instanceof ProfileError ? err.message : "That file could not be saved.", "bad");
    }
    setUploading(false);
  };

  const download = async () => {
    if (!companyId) return;
    const file = await loadProfileFile(companyId);
    if (!file) {
      toast("There is no company profile on file yet.", "warn");
      return;
    }
    /* Decoded in the browser: the bytes are already here, and a signed URL
       for a file this size is machinery for no gain. */
    const bytes = Uint8Array.from(atob(file.base64), (ch) => ch.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ── sending ───────────────────────────────────────────────────────── */

  const blockers: string[] = [];
  if (!companyId) blockers.push("Choose a company first.");
  if (!info) blockers.push("Upload the company profile PDF first.");
  if (!recipients.length) blockers.push("Choose at least one recipient.");
  if (!subject.trim()) blockers.push("The email needs a subject.");
  if (!body.trim()) blockers.push("The email needs something in the body.");
  if (!user.email) blockers.push("Your profile has no email address, so replies would go nowhere.");

  /* A VARIABLE NOTHING CAN FILL IS A BLOCKER, not a warning. It went out
     once as "{{sender_company}} — company profile" in the subject line of
     nine emails, because the company name had never been filled in on the
     settings row. The message names the variable and, where it is one of
     ours to fix, where to fix it. */
  const unfilled = [...new Set(messages.flatMap((m) => m.missing))];
  if (unfilled.length) {
    const affected = messages.filter((m) => m.missing.length);
    const where = unfilled.some((v) => v.startsWith("sender_"))
      ? " Your own details come from Settings → Company and your own profile."
      : "";
    blockers.push(
      `${unfilled.map((v) => `{{${v}}}`).join(", ")} has nothing to fill it in for `
      + `${affected.length} ${affected.length === 1 ? "recipient" : "recipients"}`
      + `${affected[0] ? ` (${affected[0].email} is the first)` : ""}, `
      + `and would arrive looking like that.${where}`,
    );
  }

  const send = async () => {
    if (!companyId || blockers.length) return;
    setResults([]);
    setStopped("");
    setProgress({ done: 0, total: messages.length });

    const batchId = crypto.randomUUID();
    const collected: Array<{ email: string; label: string; ok: boolean; error: string | null }> = [];

    /* IN PIECES, WAITING OUT WHATEVER THE SERVER ASKS IT TO — see
       domain/outreach/pacedSend.ts, where the loop lives so that a test
       can reach it. A single request for thirty would be cut off by the
       function host halfway with nothing to say which of them had gone;
       and a piece that comes back half-throttled has to record the ones
       that went, put the untouched ones back, and wait exactly as long as
       Microsoft said. That was four chances to drop a customer in code
       nothing could test. */
    const byEmail = new Map(messages.map((m) => [m.email, m]));
    const run = await runPacedSend({
      messages,
      chunkSize: CHUNK,
      send: (piece) => api.sendCompanyProfile({
        companyId,
        batchId,
        messages: piece.map((m) => ({
          email: m.email,
          customerId: m.customerId || undefined,
          label: m.label,
          subject: m.subject,
          message: m.message,
          html: m.html,
        })),
      }),
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
      onProgress: (p) => {
        setProgress({ done: p.done, total: p.total, waitingUntil: p.waitingUntil });
        setResults(collected.slice());
      },
    });

    for (const o of run.outcomes) {
      collected.push({
        email: o.email,
        label: byEmail.get(o.email)?.label ?? o.email,
        ok: o.ok,
        error: o.error,
      });
    }
    if (run.stopped) setStopped(run.stopped);

    setResults(collected);
    setProgress(null);

    const sent = collected.filter((r) => r.ok).length;
    const failed = collected.length - sent;
    if (sent && !failed) toast(`Sent to ${sent} ${sent === 1 ? "person" : "people"}, one email each`, "good");
    else if (sent && failed) toast(`${sent} sent, ${failed} did not go — see the list`, "warn");
    else if (!sent) toast("Nothing was sent", "bad");
  };

  const retryFailed = () => {
    const failed = new Set(results.filter((r) => !r.ok).map((r) => r.email));
    if (!failed.size) return;
    /* Narrow the list to the ones that did not go, so pressing Send again
       cannot write to anybody twice. */
    setChosen(new Set(picked.filter((c) => failed.has(String(c.email ?? "").toLowerCase())).map((c) => c.id)));
    setPasted(
      fromPaste.recipients.filter((r) => failed.has(r.email)).map((r) => r.email).join("\n"),
    );
    setResults([]);
  };

  const sentCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - sentCount;

  return (
    <main className="page">
      <PageHead
        title="Company profile"
        sub="Send your profile to customers — each one gets their own email."
        actions={
          <>
            {info ? <Button tone="quiet" onClick={download}>Download the PDF</Button> : null}
            {canManageProfile ? (
              <Button tone={info ? "quiet" : "default"} onClick={() => fileInput.current?.click()} disabled={uploading}>
                {uploading ? "Saving…" : info ? "Replace the PDF" : "Upload the PDF"}
              </Button>
            ) : null}
          </>
        }
      />

      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />

      {/* ── the attachment ─────────────────────────────────────────── */}
      <Card title="What is attached">
        {loadingInfo ? (
          <div className="muted">Looking…</div>
        ) : info ? (
          <div className="row-tight wrap">
            <Chip tone="good">{info.fileName}</Chip>
            <span className="muted">{sizeOf(info.bytes)}</span>
            {info.updatedAt ? <span className="muted">· on file since {when(info.updatedAt)}</span> : null}
          </div>
        ) : (
          <Empty
            title="No company profile on file yet"
            body={
              canManageProfile
                ? `Upload the PDF once and every send attaches it. Keep it under ${MAX_PROFILE_BYTES / 1048576} MB — Microsoft refuses an email much over 4 MB, and encoding adds a third.`
                : "An admin or a manager has to upload it before it can be sent."
            }
            action={canManageProfile ? <Button onClick={() => fileInput.current?.click()}>Upload the PDF</Button> : undefined}
          />
        )}
      </Card>

      {/* ── who ────────────────────────────────────────────────────── */}
      <Card
        title={`Who it goes to${recipients.length ? ` — ${recipients.length}` : ""}`}
        actions={
          <div className="row-tight">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search customers"
              aria-label="Search customers"
            />
            <Button size="sm" tone="quiet" onClick={chooseAllShown}>Choose all shown</Button>
            {chosen.size ? (
              <Button size="sm" tone="quiet" onClick={() => setChosen(new Set())}>Clear</Button>
            ) : null}
          </div>
        }
      >
        <div className="stack">
          <div className="table-wrap" style={{ maxHeight: 320, overflow: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}><span className="sr-only">Chosen</span></th>
                  <th>Customer</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {matches.slice(0, 200).map((c) => {
                  const email = String(c.email ?? "").trim().toLowerCase();
                  const had = email ? alreadySent.get(email) : null;
                  return (
                    <tr key={c.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={chosen.has(c.id)}
                          disabled={!email}
                          onChange={() => toggle(c.id)}
                          aria-label={`Send to ${c.company || c.contact || email || "this customer"}`}
                        />
                      </td>
                      <td>{c.company || <span className="muted">No company name</span>}</td>
                      <td>{c.contact || <span className="muted">—</span>}</td>
                      <td>{email || <span className="muted">No email on file</span>}</td>
                      <td>
                        <div className="row-tight wrap">
                          {had ? <Chip tone="neutral">sent {when(had)}</Chip> : null}
                          {email && optedOut.has(email) ? <Chip tone="warn">opted out of campaigns</Chip> : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {matches.length > 200 ? (
            <div className="muted">Showing the first 200 — search to narrow it.</div>
          ) : null}

          <Field
            label="Or paste addresses"
            hint="One person per line — a bare address, a name and address in two columns straight out of a spreadsheet, or an Outlook To: line with the names still on it. The name beside an address is used for the greeting. Thirty at once is fine."
          >
            <Textarea
              rows={3}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"Ravi Sharma\travi@acme.example\nPriya Nair <priya@beta.example>\narun@gamma.example"}
            />
          </Field>

          {fromPaste.unreadable.length ? (
            <div className="notice notice-warn">
              <strong>Could not read {fromPaste.unreadable.length} of what you pasted.</strong>{" "}
              {fromPaste.unreadable.slice(0, 4).map((u) => `“${u}”`).join(", ")}
              {fromPaste.unreadable.length > 4 ? " and more" : ""}. Nothing was dropped silently — fix or remove those lines.
            </div>
          ) : null}

          {[...fromCustomers.skipped, ...fromPaste.skipped].length ? (
            <div className="notice">
              {fromCustomers.skipped.filter((s) => s.reason === "no-email").length ? (
                <div>
                  <strong>No email on file:</strong>{" "}
                  {fromCustomers.skipped.filter((s) => s.reason === "no-email").map((s) => s.label).join(", ")}.
                  They are not included.
                </div>
              ) : null}
              {[...fromCustomers.skipped, ...fromPaste.skipped].filter((s) => s.reason === "duplicate").length ? (
                <div>
                  <strong>Already on the list:</strong>{" "}
                  {[...fromCustomers.skipped, ...fromPaste.skipped].filter((s) => s.reason === "duplicate").map((s) => s.label).join(", ")}.
                  Each address is written to once.
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {/* ── the words ──────────────────────────────────────────────── */}
      <Card title="The email">
        <div className="stack">
          <Field
            label="Subject"
            hint="{{sender_company}} and {{company_name}} fill themselves in per recipient."
          >
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field
            label="Note"
            hint="The greeting is added for you — “Dear Ravi,” where we have a name, the company where we only have that, and a plain “Hello,” rather than an empty one. Your signature goes underneath."
          >
            <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </div>
      </Card>

      {/* ── the preview, which is the message ────────────────────────
           THE CARD IS ALWAYS HERE. It used to disappear entirely until a
           recipient was chosen, so somebody opening this screen saw the
           note box and then the Send button and had no reason to believe a
           preview existed at all — which is exactly how it was reported.
           An empty state that says what to do is not clutter; a feature
           nobody can find is. */}
      {!preview ? (
        <Card title="What they will see">
          <div className="notice">
            <span>
              Choose who it goes to above, and the exact message that person will receive appears
              here — their greeting, your note, what we supply, and your signature. It is the real
              message, not an impression of it: what you approve here is what is sent.
            </span>
          </div>
        </Card>
      ) : (
        <Card
          title="What they will see"
          actions={
            messages.length > 1 ? (
              <div className="row-tight">
                <Button
                  size="sm" tone="quiet"
                  disabled={previewOf <= 0}
                  onClick={() => setPreviewOf((n) => Math.max(0, n - 1))}
                >
                  Previous
                </Button>
                <span className="muted">
                  {Math.min(previewOf, messages.length - 1) + 1} of {messages.length}
                </span>
                <Button
                  size="sm" tone="quiet"
                  disabled={previewOf >= messages.length - 1}
                  onClick={() => setPreviewOf((n) => Math.min(messages.length - 1, n + 1))}
                >
                  Next
                </Button>
              </div>
            ) : null
          }
        >
          <div className="stack">
            <div className="row-tight wrap">
              <Chip tone="accent" dot={false}>To: {preview.email}</Chip>
              <span className="muted">{preview.label}</span>
              {preview.missing.length ? (
                <Chip tone="warn">
                  nothing to put in {preview.missing.map((m) => `{{${m}}}`).join(", ")}
                </Chip>
              ) : null}
            </div>
            <div className="muted">Subject: {preview.subject}</div>
            <iframe
              title={`The email ${preview.email} will receive`}
              srcDoc={preview.html}
              style={{ width: "100%", height: 460, border: "1px solid var(--rule)", borderRadius: 8, background: "#fff" }}
            />
          </div>
        </Card>
      )}

      {/* ── sending ────────────────────────────────────────────────── */}
      <Card title="Send">
        <div className="stack">
          <div className="notice notice-good">
            <strong>Everybody gets their own email.</strong>{" "}
            {recipients.length ? (
              <>
                {recipients.length === 1 ? (
                  <>
                    One message goes out, addressed to that person alone — their address in To, their name in
                    the greeting, and replies coming back to {user.email || "you"}.
                  </>
                ) : (
                  <>
                    {recipients.length} separate messages go out, each addressed to one person with only their
                    own address in To, their name in the greeting, and replies coming back to{" "}
                    {user.email || "you"}. Nobody can see who else it went to.
                  </>
                )}
              </>
            ) : (
              <>
                Whoever you choose gets a message addressed to them alone — their address in To, their name in
                the greeting, replies to {user.email || "you"}. No cc, no bcc, nobody else's address anywhere.
              </>
            )}
          </div>

          {blockers.length ? (
            <div className="notice notice-warn">
              <ul className="tight">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          ) : null}

          {progress && !progress.waitingUntil ? (
            <div className="notice">
              Sending… {progress.done} of {progress.total} done. Leave this page open until it finishes.
            </div>
          ) : null}

          {/* A PAUSE THAT EXPLAINS ITSELF. Without this the send simply
              stops moving for five minutes, which reads as broken — and
              the person closes the page, which is the one thing that
              would actually break it. */}
          {progress?.waitingUntil ? (
            <div className="notice notice-warn">
              <strong>Waiting for Microsoft.</strong>{" "}
              {progress.done} of {progress.total} have gone. Microsoft limits how much one mailbox can
              upload at a time, and your profile is {((info?.bytes ?? 0) / 1048576).toFixed(1)} MB per message — so the rest go as soon
              as the window clears, in about {Math.max(1, Math.ceil((progress.waitingUntil - Date.now()) / 1000))} seconds.
              Nothing has failed and nobody will be messaged twice. Leave this page open.
            </div>
          ) : null}

          {stopped ? <div className="notice notice-bad"><strong>Stopped.</strong> {stopped}</div> : null}

          <div className="row-tight wrap">
            <Button
              onClick={() => void send()}
              disabled={!!blockers.length || !!progress}
            >
              {progress
                ? `Sending ${progress.done}/${progress.total}…`
                : recipients.length
                  ? `Send to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}`
                  : "Send"}
            </Button>
            {failedCount ? (
              <Button tone="quiet" onClick={retryFailed}>
                Try the {failedCount} that failed again
              </Button>
            ) : null}
          </div>

          {results.length ? (
            <div className="stack">
              <div className="row-tight wrap">
                <Chip tone={sentCount ? "good" : "neutral"}>{sentCount} sent</Chip>
                {failedCount ? <Chip tone="bad">{failedCount} failed</Chip> : null}
              </div>
              <div className="table-wrap" style={{ maxHeight: 260, overflow: "auto" }}>
                <table className="table">
                  <thead><tr><th>Recipient</th><th>Email</th><th>Result</th></tr></thead>
                  <tbody>
                    {results.map((r) => (
                      <tr key={r.email}>
                        <td>{r.label}</td>
                        <td>{r.email}</td>
                        <td>
                          {r.ok
                            ? <Chip tone="good">sent</Chip>
                            : <span><Chip tone="bad">failed</Chip> <span className="muted">{r.error}</span></span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </Card>

      {/* ── the same profile, on WhatsApp ───────────────────────────────
          A SECOND CARD RATHER THAN A SECOND MODE on the first one. The
          two lists are rarely the same people: the email list is whoever
          gave an address, and this one is whoever agreed to WhatsApp or
          whose number somebody has pasted. Folding them into one picker
          would mean a screen where ticking somebody does different things
          depending on a toggle they set earlier. */}
      <Card title="Send on WhatsApp">
        <div className="stack">
          <p className="muted" style={{ marginTop: 0 }}>
            The same profile PDF, sent one message at a time from the company's own WhatsApp number.
            Numbers you paste here are <strong>not</strong> saved as customers.
          </p>

          <Field
            label="Paste numbers"
            hint="One person per line — a name and number in two columns out of a spreadsheet, or bare numbers. +91 is assumed for a ten-digit number."
          >
            <Textarea
              rows={5}
              value={waPasted}
              onChange={(e) => setWaPasted(e.target.value)}
              placeholder={"Anoop Samdani\t9810012345\n+91 98200 99887\n9811122233"}
            />
          </Field>

          {waFromPaste.unreadable.length ? (
            <div className="notice notice-warn">
              <strong>Could not read {waFromPaste.unreadable.length} of what you pasted.</strong>{" "}
              {waFromPaste.unreadable.slice(0, 4).map((u) => `\u201C${u}\u201D`).join(", ")}
              {waFromPaste.unreadable.length > 4 ? " and more" : ""}. Nothing was dropped silently.
            </div>
          ) : null}

          {waFromPaste.duplicates.length ? (
            <div className="notice">
              {waFromPaste.duplicates.length} number{waFromPaste.duplicates.length === 1 ? " was" : "s were"} in the
              list more than once. Each person is messaged once.
            </div>
          ) : null}

          {picked.length ? (
            <div className="notice">
              <strong>From the customers ticked above:</strong> {audienceSummary(waFromCustomers)}
              {waFromCustomers.excluded.length ? (
                <div className="muted" style={{ marginTop: 6 }}>
                  {waFromCustomers.excluded.slice(0, 6).map((e) => e.label).join(", ")}
                  {waFromCustomers.excluded.length > 6 ? " and others" : ""} — a customer who has not
                  agreed cannot be messaged, and that tick is on their own record.
                </div>
              ) : null}
            </div>
          ) : null}

          {/* THE DECLARATION, FOR PASTED NUMBERS ONLY. A customer on file
              is governed by their own record and this cannot override it.
              What this answers is the case where there IS no record. */}
          {waFromPaste.numbers.length ? (
            <label className="row-tight" style={{ alignItems: "flex-start", gap: 10 }}>
              <input
                type="checkbox"
                checked={waVouched}
                onChange={(e) => setWaVouched(e.target.checked)}
                style={{ marginTop: 4 }}
              />
              <span>
                These {waFromPaste.numbers.length} number{waFromPaste.numbers.length === 1 ? " has" : "s have"} agreed
                to hear from us on WhatsApp.{" "}
                <span className="muted">
                  Recorded against your name on every message. WhatsApp does not check this when you send —
                  the people who receive it do, by blocking or reporting, and that falls on the number your
                  quotations go out on.
                </span>
              </span>
            </label>
          ) : null}

          {!info ? (
            <div className="notice notice-warn">Upload the company profile PDF first.</div>
          ) : null}

          {waProgress ? (
            <div className="notice">
              Sending… {waProgress.done} of {waProgress.total} done. Leave this page open until it finishes.
            </div>
          ) : null}

          {waStopped ? <div className="notice notice-bad"><strong>Stopped.</strong> {waStopped}</div> : null}

          <div className="row-tight wrap">
            <Button
              onClick={() => void sendOnWhatsApp()}
              disabled={!info || !waTotal || !!waProgress || (waFromPaste.numbers.length > 0 && !waVouched)}
            >
              {waProgress
                ? `Sending ${waProgress.done}/${waProgress.total}…`
                : waTotal
                  ? `Send to ${waTotal} on WhatsApp`
                  : "Send on WhatsApp"}
            </Button>
            {waTotal && !waProgress ? (
              <span className="muted">
                {waFromCustomers.recipients.length} from your customers, {waFromPaste.numbers.length} pasted.
              </span>
            ) : null}
          </div>

          {waResults.length ? (
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table className="table">
                <thead><tr><th>Who</th><th>Result</th></tr></thead>
                <tbody>
                  {waResults.map((r, i) => (
                    <tr key={`${r.who}-${i}`}>
                      <td>{r.who}</td>
                      <td>
                        {r.ok
                          ? <Chip tone="good">sent</Chip>
                          : <><Chip tone="bad">not sent</Chip> <span className="muted">{r.error}</span></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </Card>
    </main>
  );
}
