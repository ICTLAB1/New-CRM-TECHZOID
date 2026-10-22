import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Field, Input, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { plainTextFrom } from "../../domain/mail/plainText";
import { foldersInOutlookOrder, type ShownFolder } from "../../domain/mail/folders";
import {
  attachToDraft, deleteMail, fileToBase64, getAttachment, listAttachments,
  listFolders, listMail, markMail, moveMail, readMail,
  saveDraft, saveNewDraft, sendDraft, startUploadSession, uploadInChunks,
  MAX_ATTACHMENT_BYTES, MAX_LARGE_ATTACHMENT_BYTES, TYPICAL_MESSAGE_LIMIT_BYTES,
  type MailAttachment, type MailDraft, type MailFolder, type MailMessage,
} from "../../data/mail";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";

const PAGE = 25;
const BLANK: MailDraft = { to: "", cc: "", bcc: "", subject: "", body: "" };

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
  /* Files chosen for the message being written. They are not uploaded until
     there is a draft to hang them on — a draft is what holds an attachment,
     so one has to exist first. */
  const [files, setFiles] = useState<File[]>([]);
  const [showBcc, setShowBcc] = useState(false);
  const [onMessage, setOnMessage] = useState<MailAttachment[]>([]);
  const [progress, setProgress] = useState<{ name: string; percent: number } | null>(null);

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

  /**
   * Hand the browser the bytes as a file.
   *
   * Built from base64 rather than linked: an attachment is fetched through
   * the API with this person's token, so there is no URL that could be
   * shared or guessed to reach somebody else's mail.
   */
  const download = async (m: MailMessage, a: MailAttachment) => {
    const got = await getAttachment(m.id, a.id);
    if (got.error || !got.data?.attachment) { toast(got.error ?? "Could not download that.", "bad"); return; }
    const { base64, contentType, name } = got.data.attachment;
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      /* Revoked, or every attachment opened in a session is held in memory
         until the tab closes. */
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast("That attachment could not be decoded.", "bad");
    }
  };

  const show = async (m: MailMessage) => {
    setOpen(m);
    setOnMessage([]);
    const got = await readMail(m.id);
    if (got.data?.message) setOpen(got.data.message);
    if (m.hasAttachments) {
      const list = await listAttachments(m.id);
      if (list.data?.attachments) setOnMessage(list.data.attachments);
    }
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

  /**
   * Upload whatever was picked onto the draft that now exists.
   *
   * TWO PATHS, because Graph insists on both. Under 3 MB goes in one
   * request; a session for a file that small is refused outright
   * (ErrorAttachmentSizeShouldNotBeLessThanMinimumSize). Over 3 MB goes
   * chunk by chunk straight to Microsoft.
   */
  const uploadFiles = async (id: string): Promise<boolean> => {
    for (const file of files) {
      try {
        if (file.size <= MAX_ATTACHMENT_BYTES) {
          const base64 = await fileToBase64(file);
          const done = await attachToDraft(id, { name: file.name, contentType: file.type, base64 });
          if (done.error) { toast(done.error, "bad"); return false; }
        } else {
          setProgress({ name: file.name, percent: 0 });
          const session = await startUploadSession(id, {
            name: file.name, contentType: file.type || "application/octet-stream", size: file.size,
          });
          if (session.error || !session.data?.uploadUrl) {
            toast(session.error ?? `Could not start the upload for ${file.name}.`, "bad");
            return false;
          }
          const sent = await uploadInChunks(session.data.uploadUrl, file,
            (percent) => setProgress({ name: file.name, percent }));
          if (!sent.ok) { toast(sent.error, "bad"); return false; }
        }
      } finally {
        setProgress(null);
      }
    }
    setFiles([]);
    return true;
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
        setDraftId(id);
      } else {
        const saved = await saveDraft(id, draft);
        if (saved.error) { toast(saved.error, "bad"); return; }
      }
      /* Attachments before sending, and the draft is kept if one fails —
         the message stays in Drafts with everything typed, rather than
         going out without the file it was written to carry. */
      if (!(await uploadFiles(id))) return;
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
      const id = got.data?.id ?? draftId;
      if (id) { setDraftId(id); await uploadFiles(id); }
      toast("Saved to Drafts");
      void refreshFolders();
    } finally { setBusy(""); }
  };

  /**
   * Put a message back where it came from.
   *
   * THIS IS WHY DELETE AND ARCHIVE CAN OFFER UNDO AT ALL. Neither destroys
   * anything — Graph's delete is a move to Deleted Items — so the reverse
   * is another move, and it either works or reports that it did not. An
   * Undo offered on something genuinely gone would be worse than none,
   * because the person stops worrying the moment they see it.
   */
  const putBack = async (m: MailMessage, from: string) => {
    const got = await moveMail(m.id, from);
    if (got.error) { toast(got.error, "bad"); return; }
    setMessages((l) => (l.some((x) => x.id === m.id) ? l : [m, ...l]));
    toast("Put back");
    void refreshFolders();
  };

  const remove = async (m: MailMessage) => {
    const from = folder;
    setBusy("delete");
    const got = await deleteMail(m.id);
    setBusy("");
    if (got.error) { toast(got.error, "bad"); return; }
    setMessages((l) => l.filter((x) => x.id !== m.id));
    setOpen(null);
    toast("Moved to Deleted Items", "good", { label: "Undo", run: () => void putBack(m, from) });
    void refreshFolders();
  };

  const archive = async (m: MailMessage) => {
    const to = folders.find((f) => f.name.toLowerCase() === "archive");
    if (!to) { toast("This mailbox has no Archive folder.", "warn"); return; }
    const from = folder;
    const got = await moveMail(m.id, to.id);
    if (got.error) { toast(got.error, "bad"); return; }
    setMessages((l) => l.filter((x) => x.id !== m.id));
    setOpen(null);
    toast("Archived", "good", { label: "Undo", run: () => void putBack(m, from) });
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
            <Button tone="primary" onClick={() => { setDraft({ ...BLANK }); setDraftId(""); setFiles([]); setShowBcc(false); }}>New message</Button>
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
            {showBcc ? (
              <Field label="Bcc" hint="Nobody on the message sees these addresses.">
                <Input value={draft.bcc ?? ""} onChange={(e) => setDraft({ ...draft, bcc: e.target.value })} />
              </Field>
            ) : (
              <div><Button tone="quiet" size="sm" onClick={() => setShowBcc(true)}>Add Bcc</Button></div>
            )}
            <Field label="Subject"><Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
            <Textarea rows={10} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />

            <Field label="Attachments" hint="Up to 150 MB each. Over about 35 MB many mail servers refuse the whole message.">
              <input
                type="file"
                multiple
                onChange={(e) => {
                  const picked = [...(e.target.files ?? [])];
                  /* Refused here rather than at send. Graph takes an
                     attachment inline up to about 3 MB, and finding that out
                     after somebody has written the email is the worst moment
                     to find it out. */
                  /* 150 MB is Graph's ceiling and the only hard refusal.
                     35 MB is Exchange Online's DEFAULT message limit, which
                     an administrator can raise — so it warns and does not
                     block: refusing on a number we cannot see the real value
                     of would stop a mailbox configured for more. */
                  const tooBig = picked.filter((f) => f.size > MAX_LARGE_ATTACHMENT_BYTES);
                  if (tooBig.length) toast(`${tooBig.map((f) => f.name).join(", ")} — over 150 MB, which Outlook will not accept.`, "bad");
                  const keepable = picked.filter((f) => f.size <= MAX_LARGE_ATTACHMENT_BYTES);
                  const chunky = keepable.filter((f) => f.size > TYPICAL_MESSAGE_LIMIT_BYTES);
                  if (chunky.length) toast(`${chunky.map((f) => f.name).join(", ")} is over 35 MB — many mail servers refuse messages that size.`, "warn");
                  setFiles((have) => [...have, ...keepable]);
                  e.target.value = "";
                }}
              />
            </Field>
            {progress ? (
              <p className="muted" style={{ margin: 0 }}>
                Uploading {progress.name} — {progress.percent}%
              </p>
            ) : null}
            {files.length ? (
              <ul className="plain-list">
                {files.map((f, i) => (
                  <li key={`${f.name}:${i}`}>
                    {f.name} <span className="muted">· {Math.ceil(f.size / 1024)} KB</span>{" "}
                    <Button tone="quiet" size="sm" onClick={() => setFiles((have) => have.filter((_, n) => n !== i))}>Remove</Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="spread wrap">
              <Button tone="quiet" onClick={() => { setDraft(null); setDraftId(""); setFiles([]); }}>Close</Button>
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
              {onMessage.length ? (
                <div className="stack">
                  <div className="pt-section-title">Attachments<span className="muted"> · {onMessage.length}</span></div>
                  <ul className="plain-list">
                    {onMessage.map((a) => (
                      <li key={a.id}>
                        {a.name} <span className="muted">· {Math.ceil(a.size / 1024)} KB</span>{" "}
                        <Button tone="quiet" size="sm" onClick={() => void download(open, a)}>Download</Button>
                      </li>
                    ))}
                  </ul>
                </div>
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
