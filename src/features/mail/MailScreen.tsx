import { useCallback, useEffect, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Field, Input, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { listMail, markMail, readMail, type MailMessage } from "../../data/mail";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";
import { plainTextFrom } from "../../domain/mail/plainText";

const PAGE = 25;

const when = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
};

/**
 * The inbox, inside the CRM.
 *
 * READING AND SENDING ARE DIFFERENT GRANTS and this screen shows it: the
 * list needs the inbox connection, and a reply goes out through the send
 * path that has always existed. Somebody who has never connected their inbox
 * can still reply to nothing and send quotations as before; somebody whose
 * read grant lapses sees the Connect button and keeps sending throughout.
 */
export function MailScreen({ api, currentUser }: {
  api: IntegrationsApi;
  currentUser: { id: string; name: string; email?: string };
}) {
  const toast = useToast();
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [mailbox, setMailbox] = useState("");
  const [open, setOpen] = useState<MailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsConsent, setNeedsConsent] = useState(false);
  const [search, setSearch] = useState("");
  const [skip, setSkip] = useState(0);
  const [reply, setReply] = useState<{ to: string; subject: string; body: string } | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async (at: number, term: string) => {
    setLoading(true); setError(""); setNeedsConsent(false);
    const { data, error: failed, needsConsent: unconnected } = await listMail({ skip: at, search: term });
    setLoading(false);
    if (unconnected) { setNeedsConsent(true); setError(failed ?? ""); return; }
    if (failed || !data) { setError(failed ?? "Could not read the mailbox."); return; }
    setMessages(data.messages);
    setMailbox(data.mailbox);
  }, []);

  useEffect(() => { void load(0, ""); }, [load]);

  const show = async (m: MailMessage) => {
    setOpen(m);
    const { data } = await readMail(m.id);
    if (data?.message) setOpen(data.message);
    if (m.unread) {
      /* Best effort. The narrow Mail.Read grant cannot write, so this often
         refuses — which must not look like the message failed to open. */
      const { data: marked } = await markMail(m.id, true);
      if (marked?.ok) setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, unread: false } : x)));
    }
  };

  const connect = async () => {
    try {
      window.location.href = await api.startMailboxConnection("inbox");
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't start the connection.");
    }
  };

  const sendReply = async () => {
    if (!reply || sending) return;
    setSending(true);
    try {
      await api.sendEmail({
        to: reply.to,
        subject: reply.subject,
        message: reply.body,
        replyTo: currentUser.email || undefined,
      });
      toast("Reply sent");
      setReply(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not send that reply.", "bad");
    } finally {
      setSending(false);
    }
  };

  if (needsConsent) {
    return (
      <main className="page">
        <PageHead title="Mail" sub="Your Microsoft 365 inbox, inside the CRM." />
        <Card title="Connect your inbox">
          <div className="stack">
            <p style={{ margin: 0 }}>
              Reading your mail is a separate permission from sending it. Connecting here asks
              Microsoft for read access only — <strong>sending is untouched</strong>, and
              disconnecting later costs you nothing but this screen.
            </p>
            {error ? <p className="muted" style={{ margin: 0 }}>{error}</p> : null}
            <div><Button tone="primary" onClick={() => void connect()}>Connect my inbox</Button></div>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="page">
      <PageHead
        title="Mail"
        sub={mailbox ? `${mailbox} — newest first.` : "Your Microsoft 365 inbox."}
        actions={<Button tone="quiet" onClick={() => void load(skip, search)} disabled={loading}>Refresh</Button>}
      />

      <Card>
        <div className="spread wrap">
          <Input
            value={search}
            placeholder="Search this mailbox"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setSkip(0); void load(0, search); } }}
          />
          <Button onClick={() => { setSkip(0); void load(0, search); }} disabled={loading}>Search</Button>
        </div>
      </Card>

      {error ? <Card><p className="bad" style={{ margin: 0 }}>{error}</p></Card> : null}

      <Card padded={false}>
        {loading ? (
          <p className="muted" style={{ padding: "var(--gap-wide)" }}>Reading your mailbox…</p>
        ) : messages.length === 0 ? (
          <p className="muted" style={{ padding: "var(--gap-wide)" }}>Nothing here.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {messages.map((m) => (
                  <tr key={m.id} onClick={() => void show(m)} style={{ cursor: "pointer" }}>
                    <td data-label="From">
                      <strong>{m.from.name || m.from.address || "(unknown)"}</strong>
                      <div className={m.unread ? "strong" : "muted"}>{m.subject}</div>
                      <div className="muted">{m.preview.slice(0, 120)}</div>
                    </td>
                    <td data-label="When" className="num muted">
                      {when(m.receivedAt)}
                      {m.unread ? <div><span className="chip accent">new</span></div> : null}
                      {m.hasAttachments ? <div className="muted">attachment</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="spread wrap">
        <Button
          tone="quiet"
          disabled={skip === 0 || loading}
          onClick={() => { const at = Math.max(skip - PAGE, 0); setSkip(at); void load(at, search); }}
        >Newer</Button>
        <Button
          tone="quiet"
          disabled={messages.length < PAGE || loading}
          onClick={() => { const at = skip + PAGE; setSkip(at); void load(at, search); }}
        >Older</Button>
      </div>

      {open ? (
        <Card title={open.subject}>
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              {open.from.name} &lt;{open.from.address}&gt; · {when(open.receivedAt)}
            </p>
            {/* A text node, so React escapes it and the sender's markup
                cannot execute. The rule this depends on: never render a
                message body with dangerouslySetInnerHTML — a mailbox is the
                one place here whose content is written by people outside
                the company. */}
            <pre className="mail-body" style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>
              {open.contentType === "html"
                ? plainTextFrom(open.content ?? "")
                : open.content ?? open.preview}
            </pre>
            <div className="spread wrap">
              <Button tone="quiet" onClick={() => setOpen(null)}>Close</Button>
              <Button
                tone="primary"
                onClick={() => setReply({
                  to: open.from.address,
                  subject: open.subject.startsWith("Re:") ? open.subject : `Re: ${open.subject}`,
                  body: "",
                })}
              >Reply</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {reply ? (
        <Card title="Reply">
          <div className="stack">
            <Field label="To"><Input value={reply.to} onChange={(e) => setReply({ ...reply, to: e.target.value })} /></Field>
            <Field label="Subject"><Input value={reply.subject} onChange={(e) => setReply({ ...reply, subject: e.target.value })} /></Field>
            <Textarea rows={8} value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} />
            <div className="spread wrap">
              <Button tone="quiet" onClick={() => setReply(null)}>Discard</Button>
              <Button tone="primary" onClick={() => void sendReply()} disabled={sending || !reply.to || !reply.body.trim()}>
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
            <p className="field-hint">
              Goes out through your connected Microsoft mailbox, the same way quotations do,
              so a copy lands in your Sent Items.
            </p>
          </div>
        </Card>
      ) : null}
    </main>
  );
}
