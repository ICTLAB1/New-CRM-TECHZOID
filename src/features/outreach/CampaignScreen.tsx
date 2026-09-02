import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import {
  Button, Card, Chip, Empty, Field, Input, Meter, Select, StatTile, SummaryBar, Textarea,
} from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { TEMPLATES, byId } from "../../domain/outreach/templates";
import { GREETING_FALLBACK, valuesFor } from "../../domain/outreach/personalise";
import { renderSignature, signatureFrom } from "../../domain/outreach/signature";
import { previewHtml } from "../../domain/outreach/preview";
import {
  DEFAULT_SCHEDULE, audienceSummary, buildAudience, excludedByReason,
  perHourCeiling, workingDaysNeeded, type Schedule,
} from "../../domain/outreach/sending";
import {
  allSendableProspects, campaignProgress, cancelCampaign, launchCampaign, listCampaigns,
  mySendingAccounts, outreachAvailable, saveCampaign, sendTestEmail, setCampaignStatus, suppressedAddresses,
  type CampaignRow, type CampaignProgress, type ProspectRow, type SendingAccount,
} from "../../data/outreach";
import { currentSession } from "../../data/session";
import { RecipientsPicker } from "./RecipientsPicker";
import { SenderPanel } from "./SenderPanel";
import type { Block } from "../../domain/outreach/emailHtml";

/**
 * Writing a campaign, and watching it go out.
 *
 * TWO THINGS ON ONE SCREEN, deliberately. A composer that hands you off to a
 * separate "campaigns" list the moment you press Launch is a composer that
 * lets somebody start a 400-person campaign and never look at it again. The
 * running campaigns are above the editor, so the first thing anybody writing
 * a new one sees is what the last one is doing.
 *
 * THE NUMBER BEFORE THE BUTTON. Nothing here says "Launch" without first
 * saying how many people will actually receive it and why the rest will not.
 * That figure is computed by the same rules the server will apply — the
 * shared module in src/domain/outreach/sending.ts, mirrored server-side and
 * pinned to it by a parity test — so the count shown is the count that
 * happens, not an optimistic guess the server then quietly reduces.
 */

export interface CampaignScreenProps {
  currentUser: { id: string; name: string; email?: string; designation?: string; role: string };
  settings: Record<string, unknown>;
  /** Prospect ids arriving from the Prospects screen's "Write to selected". */
  preselected?: string[];
  onDoneWithPreselection?: () => void;
}

/** Turn a template's blocks into the plain text somebody edits. The campaign
 *  stores words, not a structure: what was sent has to be readable back
 *  without re-running a renderer that may have changed since. */
function templateToText(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "paragraph") out.push(String(b.text ?? ""));
    else if (b.kind === "bullets") out.push((b.items ?? []).map((i) => `- ${i}`).join("\n"));
    else if (b.kind === "numbers") out.push((b.items ?? []).map((i, n) => `${n + 1}. ${i}`).join("\n"));
    else if (b.kind === "signature") out.push(String(b.text ?? ""));
  }
  return out.join("\n\n").replace(/\*\*([^*]+)\*\*/g, "$1");
}

export function CampaignScreen({ currentUser, settings, preselected, onDoneWithPreselection }: CampaignScreenProps) {
  const toast = useToast();
  const available = outreachAvailable();

  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [progress, setProgress] = useState<Record<string, CampaignProgress>>({});
  const [accounts, setAccounts] = useState<SendingAccount[]>([]);
  const [prospects, setProspects] = useState<ProspectRow[]>([]);
  const [suppressed, setSuppressed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState("");
  const [schedule, setSchedule] = useState<Schedule>(DEFAULT_SCHEDULE);
  const [allowMissing, setAllowMissing] = useState(false);
  /* personalise.ts defines GREETING_FALLBACK and deliberately does not
     apply it by itself. This is the deliberate choice it was waiting for. */
  const [greetUnnamed, setGreetUnnamed] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(preselected ?? []));
  const [launching, setLaunching] = useState(false);
  const [testing, setTesting] = useState(false);

  const company = (settings["company"] as { name?: string } | undefined)?.name ?? "";

  const refresh = useCallback(async () => {
    if (!available) { setLoading(false); return; }
    try {
      const [cs, accs, ps, sup] = await Promise.all([
        listCampaigns(50),
        mySendingAccounts(),
        allSendableProspects(),
        suppressedAddresses(),
      ]);
      setCampaigns(cs);
      setAccounts(accs);
      setProspects(ps);
      setSuppressed(sup);
      /* Functional form, so `fromAccountId` need not be a dependency of this
         callback. It was, and because this also sets it, every mount fetched
         everything twice. */
      setFromAccountId((current) => current ?? accs.find((a) => a.isDefault)?.id ?? accs[0]?.id ?? null);

      const live = cs.filter((c) => c.status === "sending" || c.status === "paused");
      const tallies = await Promise.all(live.map((c) => campaignProgress(c.id).then((p) => [c.id, p] as const)));
      setProgress(Object.fromEntries(tallies));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not load campaigns.", "bad");
    } finally {
      setLoading(false);
    }
  }, [available, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (preselected?.length) {
      setChosen(new Set(preselected));
      onDoneWithPreselection?.();
    }
  }, [preselected, onDoneWithPreselection]);

  /* The same fields the server builds at launch, from the same places — the
     profile for who is writing, settings for the company. They were not the
     same: this passed the designation only as `signature`, and the server
     passed no company at all, so {{sender_company}} was filled here and
     literal in the email. */
  /* Saving a job title from the panel below has to change the preview
     immediately. The profile is loaded by the app shell, so rather than
     plumb a callback all the way up, the freshly saved value is held here
     and wins over the copy this screen was handed. */
  const [designationOverride, setDesignationOverride] = useState<string | null>(null);
  const designation = designationOverride ?? currentUser.designation ?? "";

  const sender = useMemo(
    () => ({
      name: currentUser.name,
      email: currentUser.email ?? "",
      company,
      designation,
      phone: String((settings["company"] as { phone?: string } | undefined)?.phone ?? ""),
      signature: designation,
    }),
    [currentUser, company, settings, designation],
  );

  const candidates = useMemo(
    () => prospects
      .filter((p) => chosen.size === 0 || chosen.has(p.id))
      .map((p) => {
        const values = valuesFor(p, sender);
        /* Filled in BEFORE the rules run, so somebody with no name simply is
           not missing one any more — rather than being excluded and then
           smuggled past the exclusion. The audience rules stay untouched,
           which keeps them identical to the server's copy. */
        if (greetUnnamed && !values.first_name?.trim()) values.first_name = GREETING_FALLBACK;
        return {
          id: p.id,
          email: p.email,
          values,
          quarantined: p.quarantined,
          verificationStatus: p.verificationStatus,
        };
      }),
    [prospects, chosen, sender, greetUnnamed],
  );

  /* The same rules the server will apply. See the note at the top. */
  const audience = useMemo(
    () => buildAudience({
      candidates,
      parts: { subject, body },
      suppressed,
      allowMissing,
    }),
    [candidates, subject, body, suppressed, allowMissing],
  );

  const summary = audienceSummary(audience);
  const reasons = excludedByReason(audience);
  const days = workingDaysNeeded(summary.sending, schedule);

  /* Rendered with a real prospect's details, never with placeholder text.
     A preview that says "Hello {{first_name}}" proves nothing about whether
     the data behind the campaign is any good. */
  const signatureHtml = useMemo(
    () => renderSignature(signatureFrom(settings, { ...currentUser, designation })),
    [settings, currentUser, designation],
  );

  const preview = useMemo(() => {
    const first = audience.send[0];
    if (!first) return null;
    const fill = (t: string) =>
      t.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, k: string) => {
        const v = (first.values as Record<string, string | undefined>)[k];
        return v && v.trim() ? v : whole;
      });
    const filled = fill(body);
    return {
      to: first.email,
      subject: fill(subject),
      body: filled,
      html: previewHtml(filled, signatureHtml),
    };
  }, [audience.send, subject, body, signatureHtml]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = byId(id);
    if (!t) return;
    setSubject(t.subject);
    setBody(templateToText(t.blocks));
    if (!name.trim()) setName(t.name);
  }

  const canLaunch = !!name.trim() && !!subject.trim() && !!body.trim()
    && summary.sending > 0 && !!fromAccountId && !launching;

  /* The review loop. A campaign drains through a queue every fifteen minutes
     at one message every ninety seconds, which is right for four hundred
     strangers and useless for "does this look right?". */
  async function sendTest() {
    setTesting(true);
    try {
      const session = await currentSession();
      const token = session?.access_token;
      if (!token) throw new Error("Your session has expired. Sign in again.");

      const out = await sendTestEmail({
        subject, body, fromAccountId, replyTo,
        /* Rendered against the first person who would actually receive it, so
           the test shows their details rather than a template. */
        prospectId: audience.send[0]?.id,
        greetUnnamed,
        accessToken: token,
      });
      toast(`Sent to ${out.to}. It should arrive within a minute.`, "good");
    } catch (err) {
      toast(err instanceof Error ? err.message : "The test could not be sent.", "bad");
    } finally {
      setTesting(false);
    }
  }

  async function launch() {
    setLaunching(true);
    try {
      const session = await currentSession();
      const token = session?.access_token;
      if (!token) throw new Error("Your session has expired. Sign in again.");

      const saved = await saveCampaign({
        ownerId: currentUser.id,
        name, fromAccountId, subject, body,
        html: "", templateId, replyTo, schedule,
      });

      const out = await launchCampaign({
        campaignId: saved.id,
        prospectIds: audience.send.map((r) => r.id),
        allowMissing,
        /* The server applies the same fallback before running the rules, so
           from its point of view those people are not missing a name either.
           Forcing allowMissing here instead would ALSO let a missing company
           through, which this screen never offered. */
        greetUnnamed,
        accessToken: token,
      });

      toast(
        !out.queued
          ? "Nothing was queued — everybody on that list was excluded."
          : out.sentNow
            ? `${out.queued} queued, ${out.sentNow} already on the way. The rest follow at the pace set above.`
            : `${out.queued} queued. Nothing has gone out yet — outside your sending hours, or the day's limit is spent.`,
        out.queued ? "good" : "warn",
      );

      setName(""); setSubject(""); setBody(""); setTemplateId(""); setChosen(new Set());
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "The campaign could not be launched.", "bad");
    } finally {
      setLaunching(false);
    }
  }

  if (!available) {
    return (
      <main className="page">
        <PageHead title="Campaigns" />
        <Empty
          title="Campaigns need the database"
          body="This screen reads and writes live data, so it is unavailable in the preview build."
        />
      </main>
    );
  }

  const live = campaigns.filter((c) => c.status === "sending" || c.status === "paused");

  return (
    <main className="page">
      <PageHead
        title="Campaigns"
        sub="Write once, send slowly. Nothing goes out at night, at the weekend, or faster than the throttle allows."
      />

      {live.length ? (
        <Card title="Sending now" padded={false}>
          <table className="table">
            <thead>
              <tr><th>Campaign</th><th>Progress</th><th>Sent</th><th>Failed</th><th>Left</th><th /></tr>
            </thead>
            <tbody>
              {live.map((c) => {
                const p = progress[c.id];
                const done = p ? p.sent + p.failed + p.skipped : 0;
                const pct = p && p.total ? Math.round((done / p.total) * 100) : 0;
                return (
                  <tr key={c.id}>
                    <td>
                      <div>{c.name || "Untitled"}</div>
                      <div className="muted small">
                        {c.schedule.dailyCap}/day · {c.schedule.sendFromHour}:00–{c.schedule.sendToHour}:00 {c.schedule.timezone}
                      </div>
                    </td>
                    <td style={{ minWidth: 140 }}>
                      <Meter pct={pct} tone={c.status === "paused" ? "warn" : "good"} />
                      <div className="muted small">
                        {c.status === "paused" ? "Paused" : `${pct}%`}
                      </div>
                    </td>
                    <td className="num">{p?.sent ?? 0}</td>
                    <td className="num">{p?.failed ? <Chip tone="bad">{p.failed}</Chip> : 0}</td>
                    <td className="num">{p?.queued ?? 0}</td>
                    <td className="num">
                      <div className="row-tight">
                        <Button
                          tone="quiet"
                          onClick={async () => {
                            await setCampaignStatus(c.id, c.status === "paused" ? "sending" : "paused");
                            await refresh();
                          }}
                        >
                          {c.status === "paused" ? "Resume" : "Pause"}
                        </Button>
                        <Button
                          tone="quiet"
                          onClick={async () => { await cancelCampaign(c.id); await refresh(); }}
                        >
                          Stop
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ) : null}

      <Card title="New campaign" padded>
        <div className="grid grid-2">
          <Field label="Name" hint="For you, not the recipient.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Autodesk renewals — Q3" />
          </Field>

          <Field label="Start from a template" hint="Everything stays editable afterwards.">
            <Select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">— write it myself —</option>
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </Field>

          <Field
            label="Send from"
            hint={accounts.length ? "" : "No mailbox is connected. Connect one in Settings → Integrations."}
            error={accounts.length ? undefined : "A campaign needs a mailbox to send from."}
          >
            <Select
              value={fromAccountId ?? ""}
              invalid={!fromAccountId}
              onChange={(e) => setFromAccountId(e.target.value || null)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName ? `${a.displayName} <${a.email}>` : a.email}
                </option>
              ))}
              {!accounts.length ? <option value="">No mailbox connected</option> : null}
            </Select>
          </Field>

          <Field label="Replies go to" hint="Leave blank to use the sending mailbox.">
            <Input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder={currentUser.email ?? ""} />
          </Field>
        </div>

        <Field label="Subject">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Software licensing for {{company_name}}" />
        </Field>

        <Field
          label="Message"
          hint="Use {{first_name}}, {{company_name}}, {{job_title}} and the rest. A blank value holds that person back rather than leaving a hole."
        >
          <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>

        <SenderPanel
          sender={sender}
          subject={subject}
          body={body}
          onDesignationSaved={setDesignationOverride}
        />

        {audience.unknownVariables.length ? (
          <Card title="Check these" padded>
            <p style={{ margin: 0 }}>
              This message uses {audience.unknownVariables.map((v) => `{{${v}}}`).join(", ")}, which
              this CRM cannot fill in. Almost always a typo — it will be sent literally, braces and all.
            </p>
          </Card>
        ) : null}
      </Card>

      <RecipientsPicker
        ownerId={currentUser.id}
        prospects={prospects}
        suppressed={suppressed}
        selected={chosen}
        onSelectedChange={setChosen}
        onImported={() => void refresh()}
      />

      <Card title="How fast" padded>
        <div className="grid grid-2">
          <Field label="Most per day" hint="Fifty from one mailbox is unremarkable. Two hundred from a new domain is not.">
            <Input
              numeric
              value={String(schedule.dailyCap)}
              onChange={(e) => setSchedule((s) => ({ ...s, dailyCap: clamp(Number(e.target.value) || 0, 1, 500) }))}
            />
          </Field>
          <Field label="Seconds between messages">
            <Input
              numeric
              value={String(schedule.minGapSeconds)}
              onChange={(e) => setSchedule((s) => ({ ...s, minGapSeconds: clamp(Number(e.target.value) || 0, 5, 3600) }))}
            />
          </Field>
          <Field label="Sending hours" hint="In the campaign's timezone. Nobody believes an email that arrives at 03:12.">
            <div className="row-tight">
              <Input
                numeric
                value={String(schedule.sendFromHour)}
                onChange={(e) => setSchedule((s) => ({ ...s, sendFromHour: clamp(Number(e.target.value) || 0, 0, 23) }))}
              />
              <span className="muted">to</span>
              <Input
                numeric
                value={String(schedule.sendToHour)}
                onChange={(e) => setSchedule((s) => ({ ...s, sendToHour: clamp(Number(e.target.value) || 0, 1, 24) }))}
              />
            </div>
          </Field>
          <Field label="Days">
            <Select
              value={schedule.sendDays.length === 7 ? "all" : "weekdays"}
              onChange={(e) =>
                setSchedule((s) => ({
                  ...s,
                  sendDays: e.target.value === "all" ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5],
                }))
              }
            >
              <option value="weekdays">Weekdays only</option>
              <option value="all">Every day</option>
            </Select>
          </Field>
        </div>
        {schedule.sendToHour <= schedule.sendFromHour ? (
          <p className="small" style={{ color: "var(--bad, #b91c1c)" }}>
            The closing hour has to be later than the opening one, or nothing will ever send.
          </p>
        ) : (
          <p className="muted small" style={{ marginBottom: 0 }}>
            At most {Math.min(schedule.dailyCap, perHourCeiling(schedule))} a day in practice —
            whichever of the daily limit and the gap between messages binds first.
          </p>
        )}
      </Card>

      <Card title="Who will receive this" padded>
        <SummaryBar columns={3}>
          <StatTile label="Chosen" value={String(summary.total)} meta={chosen.size ? "selected" : "every sendable prospect"} />
          <StatTile label="Will be sent" value={String(summary.sending)} tone={summary.sending ? "good" : "bad"} />
          <StatTile
            label="Working days to finish"
            value={days ? String(days) : "—"}
            meta={days > 5 ? "consider a higher cap" : ""}
            tone={days > 10 ? "warn" : undefined}
          />
        </SummaryBar>

        {reasons.length ? (
          <table className="table compact">
            <thead><tr><th>Held back</th><th className="num">People</th></tr></thead>
            <tbody>
              {reasons.map((r) => (
                <tr key={r.reason}>
                  <td>{r.label}</td>
                  <td className="num">{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <label className="row-tight small" style={{ margin: "12px 0 4px" }}>
          <input type="checkbox" checked={greetUnnamed} onChange={(e) => setGreetUnnamed(e.target.checked)} />
          Greet anyone with no first name as “{GREETING_FALLBACK}” — for shared inboxes like procurement@
        </label>
        <label className="row-tight small" style={{ margin: "0 0 12px" }}>
          <input type="checkbox" checked={allowMissing} onChange={(e) => setAllowMissing(e.target.checked)} />
          Send even where a detail is still missing — that variable will appear literally, braces and all
        </label>

        {preview ? (
          <Card title={`Preview — as ${preview.to} will see it`} padded>
            <p className="muted small" style={{ marginTop: 0 }}>
              A real prospect's details, and the same renderer the email itself uses — including the
              signature and the unsubscribe line.
            </p>
            <p style={{ margin: "0 0 8px" }}><strong>{preview.subject}</strong></p>
            <div
              style={{ border: "1px solid var(--rule, #e5e7eb)", borderRadius: 6, background: "#fff", overflowX: "auto" }}
              /* Built here from this workspace's own settings and this
                 campaign's own words, every value escaped on the way through
                 — not markup arriving from anywhere else. */
              dangerouslySetInnerHTML={{ __html: preview.html }}
            />
          </Card>
        ) : (
          <p className="muted small">
            Nobody on this list can be written to yet — the breakdown above says why.
          </p>
        )}

        <div className="row-tight wrap" style={{ marginTop: 12 }}>
          <Button
            loading={testing}
            disabled={!subject.trim() || !body.trim() || !fromAccountId || testing}
            onClick={() => void sendTest()}
          >
            Send a test to me
          </Button>
          <Button tone="primary" disabled={!canLaunch} loading={launching} onClick={() => void launch()}>
            {summary.sending
              ? `Launch — ${summary.sending} recipient${summary.sending === 1 ? "" : "s"}`
              : "Nobody to send to"}
          </Button>
          {chosen.size ? (
            <Button onClick={() => setChosen(new Set())}>Use every prospect instead</Button>
          ) : null}
        </div>
        <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
          A test goes to your own address straight away and is marked “[Test]” in the subject —
          nothing else about it differs, and it spends none of the day’s limit. Launching starts
          sending immediately: the first messages leave within seconds, and the rest follow at the
          pace set above, pausing outside your sending hours.
        </p>
      </Card>

      {loading ? <p className="muted">Loading…</p> : null}
    </main>
  );
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
