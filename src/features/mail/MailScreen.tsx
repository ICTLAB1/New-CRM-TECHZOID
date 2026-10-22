import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Field, Input, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { plainTextFrom } from "../../domain/mail/plainText";
import { foldersInOutlookOrder, type ShownFolder } from "../../domain/mail/folders";
import {
  deleteMail, listFolders, listMail, markMail, moveMail, readMail,
  saveDraft, saveNewDraft, sendDraft,
  type MailDraft, type MailFolder, type MailMessage,
} from "../../data/mail";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";

const PAGE = 25;
const BLANK: MailDraft = { to: "", cc: "", subject: "", body: "" };

const when = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
};

/**
 * The mailbox.
 *
 * Three panes — folders, messages, the one you are reading — because that is
 * what every mail client has looked like for thirty years and the muscle
 * memory is worth more than novelty here. On a phone it is one column, since
 * three panes side by side is nobody's idea of readable.
 *
 * A DRAFT IS SAVED BEFORE IT IS SENT, always. Composing goes through
 * Graph's draft: created on first save, updated after, and sent by its id.
 * Sending a body straight from the page means a failed send leaves whatever
 * was typed nowhere at all, and people write long emails.
 */
export function MailScreen({ api }: { api: IntegrationsApi }) {
  const toast = useToast();
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [folder, setFolder] = useState("inbox");
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [open, setOpen] = useState<MailMessage | null>(null);
  const [mailbox, setMailbox] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsConsent, setNeedsConsent] = useState(false);
  const [search, setSearch] = useState("");
  const [skip, setSkip] = useState(0);
  const [draft, setDraft] = useState<MailDraft | null>(null);
  const [draftId, setDraftId] = useState("");
  const [busy, setBusy] = useState("");

  const shown: ShownFolder[] = useMemo(() => foldersInOutlookOrder(folders), [folders]);

  const load = useCallback(async (which: string, at: number, term: string) => {
    setLoading(true); setError(""); setNeedsConsent(false); setOpen(null);
    const got = await listMail({ folder: which, skip: at, search: term });
    setLoading(false);
    if (got.needsConsent) { setNeedsConsent(true); setError(got.error ?? ""); return; }
    if (got.error || !got.data) { setError(got.error ?? "Could not read the mailbox."); return; }
    setMessages(got.data.messages);
    setMailbox(got.data.mailbox);
  }, []);

  const refreshFolders = useCallback(async () => {
    const got = await listFolders();
    if (got.needsConsent) { setNeedsConsent(true); return; }
    if (got.data) setFolders(got.data.folders);
  }, []);

  useEffect(() => { void refreshFolders(); void load("inbox", 0, ""); }, [load, refreshFolders]);

  const show = async (m: MailMessage) => {
    setOpen(m);
    const got = await readMail(m.id);
    if (got.data?.message) setOpen(got.data.message);
    if (m.unread) {
      const marked = await markMail(m.id, true);
      if (marked.data?.ok) {
        setMessages((l) => l.map((x) => (x.id === m.id ? { ...x, unread: false } : x)));
        void refreshFolders();
      }
    }
  };

  const go = (which: string) => { setFolder(which); setSkip(0); setSearch(""); void load(which, 0, ""); };

  const connect = async () => {
    try { window.location.href = await api.startMailboxConnection("inbox"); }
    catch (err) { setError(err instanceof IntegrationError ? err.message : "Couldn't start the connection."); }
  };

  /** Save first, then send by id, so nothing typed can be lost to a failure. */
  const send = async () => {
    if (!draft || busy) return;
    setBusy("send");
    try {
      let id = draftId;
      if (!id) {
        const made = await saveNewDraft(draft);
        if (made.error || !made.data?.id) { toast(made.error ?? "Could not save that message.", "bad"); return; }
        id = made.data.id;
      } else {
        const saved = await saveDraft(id, draft);
        if (saved.error) { toast(saved.error, "bad"); return; }
      }
      const sent = await sendDraft(id);
      if (sent.error) { toast(sent.error, "bad"); return; }
      toast("Sent");
      setDraft(null); setDraftId("");
      void refreshFolders();
    } finally { setBusy(""); }
  };

  const keep = async () => {
    if (!draft || busy) return;
    setBusy("save");
    try {
      const got = draftId ? await saveDraft(draftId, draft) : await saveNewDraft(draft);
      if (got.error) { toast(got.error, "bad"); return; }
      if (got.data?.id) setDraftId(got.data.id);
      toast("Saved to Drafts");
      void refreshFolders();
    } finally { setBusy(""); }
  };

  const remove = async (m: MailMessage) => {
    setBusy("delete");
    const got = await deleteMail(m.id);
    setBusy("");
    if (got.error) { toast(got.error, "bad"); return; }
    setMessages((l) => l.filter((x) => x.id !== m.id));
    setOpen(null);
    toast("Moved to Deleted Items");
    void refreshFolders();
  };

  const archive = async (m: MailMessage) => {
    const to = folders.find((f) => f.name.toLowerCase() === "archive");
    if (!to) { toast("This mailbox has no Archive folder.", "warn"); return; }
    const got = await moveMail(m.id, to.id);
    if (got.error) { toast(got.error, "bad"); return; }
    setMessages((l) => l.filter((x) => x.id !== m.id));
    setOpen(null);
    toast("Archived");
    void refreshFolders();
  };

  if (needsConsent) {
    return (
      <main className="page">
        <PageHead title="Mail" sub="Your Microsoft 365 mailbox, inside the CRM." />
        <Card title="Connect your mailbox">
          <div className="stack">
            <p style={{ margin: 0 }}>
              This is a separate permission from the one that sends your quotations.
              Connecting here lets the CRM show, write and send your mail —{" "}
              <strong>your quotation sending is untouched</strong>, and disconnecting later
              costs you nothing but this screen.
            </p>
            {error ? <p className="muted" style={{ margin: 0 }}>{error}</p> : null}
            <div><Button tone="primary" onClick={() => void connect()}>Connect my mailbox</Button></div>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="page">
      <PageHead
        title="Mail"
        sub={mailbox || "Your Microsoft 365 mailbox."}
        actions={
          <div className="spread wrap" style={{ gap: 8 }}>
            <Button tone="quiet" onClick={() => void load(folder, skip, search)} disabled={loading}>Refresh</Button>
            <Button tone="primary" onClick={() => { setDraft({ ...BLANK }); setDraftId(""); }}>New message</Button>
          </div>
        }
      />

      {error ? <Card><p className="bad" style={{ margin: 0 }}>{error}</p></Card> : null}

      {draft ? (
        <Card title={draftId ? "Draft" : "New message"}>
          <div className="stack">
            <Field label="To"><Input value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} placeholder="name@company.com" /></Field>
            <Field label="Cc" hint="Optional. Separate several with commas.">
              <Input value={draft.cc ?? ""} onChange={(e) => setDraft({ ...draft, cc: e.target.value })} />
            </Field>
            <Field label="Subject"><Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
            <Textarea rows={10} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <div className="spread wrap">
              <Button tone="quiet" onClick={() => { setDraft(null); setDraftId(""); }}>Close</Button>
              <div className="spread wrap" style={{ gap: 8 }}>
                <Button tone="quiet" onClick={() => void keep()} disabled={!!busy}>
                  {busy === "save" ? "Saving…" : "Save draft"}
                </Button>
                <Button tone="primary" onClick={() => void send()} disabled={!!busy || !draft.to.trim()}>
                  {busy === "send" ? "Sending…" : "Send"}
                </Button>
              </div>
            </div>
            <p className="field-hint">Saved to Drafts before it is sent, so a failed send never loses what you wrote.</p>
          </div>
        </Card>
      ) : null}

      <div className="mail-shell">
        <nav className="mail-rail" aria-label="Folders">
          {shown.map((f) => (
            <button
              key={f.key}
              type="button"
              className="mail-folder"
              aria-current={folder === f.key}
              onClick={() => go(f.key)}
            >
              <span>{f.label}</span>
              {f.unread > 0 ? <span className="count">{f.unread}</span> : null}
            </button>
          ))}
        </nav>

        <div className="mail-list">
          <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)" }}>
            <Input
              value={search}
              placeholder="Search mail"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setSkip(0); void load(folder, 0, search); } }}
            />
          </div>
          {loading ? (
            <p className="muted" style={{ padding: 14 }}>Reading…</p>
          ) : messages.length === 0 ? (
            <p className="muted" style={{ padding: 14 }}>Nothing here.</p>
          ) : messages.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`mail-row${m.unread ? " is-unread" : ""}`}
              aria-current={open?.id === m.id}
              onClick={() => void show(m)}
            >
              <span className="who">
                <span>{m.from.name || m.from.address || "(unknown)"}</span>
                <span className="muted">{when(m.receivedAt)}</span>
              </span>
              <span className="subj">{m.subject}</span>
              <span className="snip">{m.preview.slice(0, 90)}</span>
            </button>
          ))}
          <div className="spread wrap" style={{ padding: 10 }}>
            <Button tone="quiet" disabled={skip === 0 || loading}
              onClick={() => { const at = Math.max(skip - PAGE, 0); setSkip(at); void load(folder, at, search); }}>Newer</Button>
            <Button tone="quiet" disabled={messages.length < PAGE || loading}
              onClick={() => { const at = skip + PAGE; setSkip(at); void load(folder, at, search); }}>Older</Button>
          </div>
        </div>

        <div className="mail-pane">
          {!open ? (
            <p className="muted">Pick a message to read it.</p>
          ) : (
            <div className="stack">
              <h2 style={{ margin: 0 }}>{open.subject}</h2>
              <p className="muted" style={{ margin: 0 }}>
                {open.from.name} &lt;{open.from.address}&gt; · {when(open.receivedAt)}
              </p>
              {open.to.length ? <p className="muted" style={{ margin: 0 }}>To: {open.to.join(", ")}</p> : null}
              <div className="spread wrap">
                <div className="spread wrap" style={{ gap: 8 }}>
                  <Button tone="primary" onClick={() => {
                    setDraftId("");
                    setDraft({
                      to: open.from.address,
                      cc: "",
                      subject: open.subject.startsWith("Re:") ? open.subject : `Re: ${open.subject}`,
                      body: `\n\n----- ${open.from.name || open.from.address} wrote -----\n${plainTextFrom(open.content ?? open.preview)}`,
                    });
                  }}>Reply</Button>
                  <Button tone="quiet" onClick={() => {
                    setDraftId("");
                    setDraft({
                      to: "", cc: "",
                      subject: open.subject.startsWith("Fw:") ? open.subject : `Fw: ${open.subject}`,
                      body: `\n\n----- Forwarded -----\nFrom: ${open.from.address}\nSubject: ${open.subject}\n\n${plainTextFrom(open.content ?? open.preview)}`,
                    });
                  }}>Forward</Button>
                </div>
                <div className="spread wrap" style={{ gap: 8 }}>
                  <Button tone="quiet" onClick={() => void archive(open)}>Archive</Button>
                  <Button tone="quiet" onClick={() => void remove(open)} disabled={busy === "delete"}>Delete</Button>
                </div>
              </div>
              {open.hasAttachments ? (
                <p className="muted" style={{ margin: 0 }}>
                  This message has attachments. They are not downloadable here yet — open it in Outlook.
                </p>
              ) : null}
              {/* A text node, so React escapes it and the sender's markup
                  cannot execute. Never render a message body with
                  dangerouslySetInnerHTML: a mailbox is the one place here
                  whose content is written by people outside the company. */}
              <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>
                {open.contentType === "html" ? plainTextFrom(open.content ?? "") : open.content ?? open.preview}
              </pre>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
