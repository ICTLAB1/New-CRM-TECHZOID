import { useCallback, useEffect, useRef, useState } from "react";
import { Presence } from "../../components/Presence";
import { Button, Card, Chip, Empty, Field, Input, Select } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { Confirm, Modal } from "../../components/Modal";
import { fmtDate } from "../../domain/dates";
import {
  allowedExtensionList, canRemove, formatBytes, isPreviewable, kindLabel, kindsFor,
  kindsPresent, ofKind, sortAttachments, totalBytes,
  type Attachment, type AttachableType,
} from "../../domain/attachments/files";
import {
  attachmentsAvailable, attachmentUrl, listAttachments, removeAttachment, uploadAttachment,
} from "../../data/attachments";

/**
 * Files kept against a customer or a document.
 *
 * Reads and writes storage directly rather than going through the workspace
 * data: an attachment is not part of the record, it hangs off it. Putting
 * files in the record's own row would mean every save rewrote every file's
 * metadata, and a 25 MB document would travel with every list query.
 *
 * DEGRADES HONESTLY. In demo mode there is nowhere to put a file, so the
 * panel says so rather than offering an upload that would quietly lose
 * somebody's signed contract.
 */

export interface AttachmentsPanelProps {
  recordType: AttachableType;
  /** Null while a record has never been saved — there is nothing to attach
   *  to yet, and a file uploaded against an id that is about to change would
   *  be orphaned. */
  recordId: string | null;
  /** Who owns the record. Kept on the file for provenance — it is NOT who
   *  is allowed to see or add one. */
  ownerId: string;
  /** The signed-in user. `id` is what the file is uploaded as and what
   *  decides whether they may remove one; `role` lets an Admin or Manager
   *  remove anybody's. */
  currentUser: { id: string; name: string; role?: string };
  /** Shown above the list. */
  title?: string;
  /** Wrapped in its own Card. Set false when this already sits inside one —
   *  a card inside a card reads as a mistake. */
  framed?: boolean;
}

export function AttachmentsPanel({
  recordType, recordId, ownerId, currentUser, title = "Attachments", framed = true,
}: AttachmentsPanelProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Attachment | null>(null);
  /* Picked, but not yet uploaded: the person is being asked what the
     document IS before it goes anywhere. */
  const [staged, setStaged] = useState<File[]>([]);
  const [kind, setKind] = useState("");
  const [note, setNote] = useState("");
  /* Which kind the list is filtered to, "" for everything. */
  const [showing, setShowing] = useState("");
  const [previewing, setPreviewing] = useState<Attachment | null>(null);

  const available = attachmentsAvailable();

  /* What is filed here, and what the list is showing. Derived rather than
     stored: a filter held in state alongside the rows goes stale the moment
     a file is added or removed. */
  const present = kindsPresent(rows, recordType);
  const listed = showing ? ofKind(rows, showing) : rows;

  const refresh = useCallback(async () => {
    if (!available || !recordId) return;
    setLoading(true);
    try {
      setRows(sortAttachments(await listAttachments(recordType, recordId)));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the attachments.");
    }
    setLoading(false);
  }, [available, recordType, recordId]);

  useEffect(() => { void refresh(); }, [refresh]);

  /* ASKED BEFORE THE UPLOAD, not after. A label added afterwards needs an
     update policy on a table that has deliberately never had one — and a
     dialog that appears once the bytes are already up is one people learn
     to dismiss. */
  const stage = (files: FileList | File[]) => {
    const picked = Array.from(files);
    if (!picked.length) return;
    setError("");
    setKind(kindsFor(recordType)[0] ?? "");
    setNote("");
    setStaged(picked);
  };

  const upload = async (files: FileList | File[], asKind: string, withNote: string) => {
    if (!recordId) return;
    setBusy(true);
    setError("");
    /* One at a time and sequential: a browser will happily start twenty
       parallel uploads and then time half of them out, and the person
       watching has no way to tell which file failed. */
    for (const file of Array.from(files)) {
      try {
        await uploadAttachment({
          file, recordType, recordId, ownerId,
          uploaderId: currentUser.id,
          uploadedBy: currentUser.name,
          kind: asKind,
          note: withNote,
        });
        toast(`${file.name} attached.`, "good");
      } catch (err) {
        const why = err instanceof Error ? err.message : "Upload failed.";
        setError(`${file.name}: ${why}`);
        toast(`${file.name} wasn't attached.`, "bad");
      }
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    await refresh();
  };

  /* For the types there is no sensible way to show in the page — a .xlsx, a
     .zip. Everything previewable opens in the viewer instead, so looking at a
     scanned PO does not mean leaving the record you were reading. */
  const download = async (row: Attachment) => {
    try {
      const url = await attachmentUrl(row);
      /* noopener because the link is signed and short-lived, but the tab it
         opens must still not be able to reach back into this one. */
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast("Couldn't open that file.", "bad");
    }
  };

  const remove = async (row: Attachment) => {
    try {
      await removeAttachment(row);
      toast(`${row.name} removed.`, "good");
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't remove that file.", "bad");
    }
    setConfirmDelete(null);
  };

  /* One wrapper, chosen once: a Card when this stands alone, a plain block
     when it is already inside one. */
  const Frame = ({ actions, children }: { actions?: React.ReactNode; children: React.ReactNode }) =>
    framed ? <Card title={title} actions={actions}>{children}</Card> : (
      <div className="stack">
        {actions ? (
          <div className="row-tight">
            <span className="eyebrow">{title}</span>
            <span className="grow" />
            {actions}
          </div>
        ) : null}
        {children}
      </div>
    );

  if (!available) {
    return (
      <Frame>
        <p className="field-hint" style={{ margin: 0 }}>
          Attachments need a signed-in workspace. This preview has nowhere to keep a file,
          so uploading is switched off rather than losing what you attach.
        </p>
      </Frame>
    );
  }

  if (!recordId) {
    return (
      <Frame>
        <p className="field-hint" style={{ margin: 0 }}>
          Save this record first — a file needs something to be attached to.
        </p>
      </Frame>
    );
  }

  return (
    <Frame
      actions={
        <Button loading={busy} loadingLabel="Uploading…" size="sm" tone="default" disabled={busy} onClick={() => inputRef.current?.click()}>
          Attach a file
        </Button>
      }
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => { if (e.target.files?.length) stage(e.target.files); }}
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files?.length) stage(e.dataTransfer.files);
        }}
        style={{
          border: `1px dashed ${dragging ? "var(--accent)" : "var(--rule)"}`,
          background: dragging ? "var(--accent-weak)" : "transparent",
          borderRadius: 8,
          padding: rows.length ? "10px 12px" : "20px 12px",
          textAlign: "center",
          transition: "background .12s ease, border-color .12s ease",
        }}
      >
        {rows.length === 0 && !loading ? (
          <Empty
            title="Nothing attached yet"
            body={`Drop a file here, or use Attach a file. Up to 25 MB each — ${allowedExtensionList()}.`}
          />
        ) : (
          <span className="field-hint">Drop a file here to attach it.</span>
        )}
      </div>

      {loading ? <p className="field-hint">Loading…</p> : null}

      {/* FILTER CHIPS, and only once there is something to filter. The
          question this answers is "where is their purchase order", and on a
          record with four files a filter nobody needs is just more to
          read. */}
      {present.length > 1 ? (
        <div className="row-tight wrap" style={{ marginTop: 12 }}>
          <button type="button" className="link-btn" onClick={() => setShowing("")}>
            <Chip tone={showing === "" ? "accent" : "neutral"}>All {rows.length}</Chip>
          </button>
          {present.map((k) => (
            <button type="button" key={k} className="link-btn" onClick={() => setShowing(showing === k ? "" : k)}>
              <Chip tone={showing === k ? "accent" : "neutral"}>{k} {ofKind(rows, k).length}</Chip>
            </button>
          ))}
        </div>
      ) : null}

      {listed.length > 0 ? (
        <>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>What it is</th>
                  <th className="num">Size</th>
                  <th>Added</th>
                  <th>By</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {listed.map((row) => (
                  <tr key={row.id}>
                    <td data-label="File">
                      <div className="strong">{row.name}</div>
                      {row.note ? <div className="field-hint">{row.note}</div> : null}
                    </td>
                    <td data-label="What it is">
                      {row.kind
                        ? <Chip tone={row.kind.toLowerCase().includes("purchase order") ? "good" : "neutral"}>{row.kind}</Chip>
                        : <span className="muted">{kindLabel(row.kind)}</span>}
                    </td>
                    <td className="num muted">{formatBytes(row.size)}</td>
                    <td className="muted">{fmtDate(row.createdAt.slice(0, 10))}</td>
                    <td className="muted">{row.uploadedBy || "—"}</td>
                    <td>
                      <span className="row-tight">
                        {isPreviewable(row.mime) ? (
                          <Button size="sm" tone="quiet" onClick={() => setPreviewing(row)}>Preview</Button>
                        ) : (
                          <Button size="sm" tone="quiet" onClick={() => void download(row)}>Download</Button>
                        )}
                        {/* Anyone may add a file; only the person who added it,
                            or an Admin/Manager, may take it away. The database
                            enforces the same rule — this hides a button that
                            would otherwise fail when pressed. */}
                        {canRemove(row, currentUser) ? (
                          <Button size="sm" tone="danger" onClick={() => setConfirmDelete(row)}>
                            Remove
                          </Button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field-hint" style={{ marginBottom: 0 }}>
            {listed.length} file{listed.length === 1 ? "" : "s"}
            {showing ? ` labelled ${showing}` : ""} · {formatBytes(totalBytes(listed))}
          </p>
        </>
      ) : null}

      {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

      <Confirm
        open={!!confirmDelete}
        title={`Remove ${confirmDelete?.name}?`}
        body="The file is deleted from storage as well. This cannot be undone."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* WHAT IS THIS? — asked once, for the files just picked. A scanner
          names a purchase order "SKM_C250i 26110312450.pdf", and three
          months later that is not a purchase order to anybody reading the
          list. One dropdown at the moment of attaching is the only point
          where somebody both knows the answer and is already here. */}
      <Modal
        open={staged.length > 0}
        title={staged.length === 1 ? "What is this document?" : `What are these ${staged.length} documents?`}
        description="The label is how anybody finds it later. It is applied to everything in this batch."
        onClose={() => setStaged([])}
        footer={
          <>
            <Button tone="quiet" onClick={() => setStaged([])}>Cancel</Button>
            <Button
              tone="primary"
              loading={busy}
              loadingLabel="Uploading…"
              disabled={busy}
              onClick={() => {
                const files = staged;
                const asKind = kind;
                const withNote = note;
                setStaged([]);
                void upload(files, asKind, withNote);
              }}
            >
              Attach {staged.length === 1 ? "it" : `all ${staged.length}`}
            </Button>
          </>
        }
      >
        <div className="stack">
          <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
            {staged.map((f) => (
              <li key={f.name + f.size} className="field-hint">{f.name} · {formatBytes(f.size)}</li>
            ))}
          </ul>
          <Field label="What it is">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              {kindsFor(recordType).map((k) => <option key={k}>{k}</option>)}
            </Select>
          </Field>
          <Field
            label="Reference"
            hint="Optional — their PO number, the date on it, anything you would search for."
          >
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. PO 4471 dated 3 Nov 2026" />
          </Field>
        </div>
      </Modal>

      <Presence value={previewing}>
        {(file, open) => (
          <AttachmentPreview attachment={file} open={open} onClose={() => setPreviewing(null)} />
        )}
      </Presence>
    </Frame>
  );
}

/* ── looking at a file without leaving the record ──────────────────── */

/**
 * Preview an image or a PDF in place.
 *
 * The signed URL is fetched when the viewer opens rather than held on every
 * row: a list of twenty files would otherwise mint twenty links, nineteen of
 * which nobody clicks, and each one is a working way into the bucket for the
 * next five minutes.
 *
 * "Open in a new tab" stays, because a PDF in a full browser tab is a better
 * reader than any frame — this is for the glance, not for the read.
 */
function AttachmentPreview({ attachment, open = true, onClose }: { attachment: Attachment; open?: boolean; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    attachmentUrl(attachment)
      .then((u) => { if (live) setUrl(u); })
      .catch(() => { if (live) setError("Couldn't open that file."); });
    /* The link outlives this component by minutes; the guard is against
       setting state on something already closed, not against the URL. */
    return () => { live = false; };
  }, [attachment]);

  const isImage = attachment.mime.startsWith("image/");

  return (
    <Modal
      open={open}
      title={attachment.name}
      description={`${formatBytes(attachment.size)}${attachment.uploadedBy ? ` · added by ${attachment.uploadedBy}` : ""}`}
      onClose={onClose}
      footer={
        <>
          <Button tone="quiet" onClick={onClose}>Close</Button>
          <Button
            tone="default"
            disabled={!url}
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
          >
            Open in a new tab
          </Button>
        </>
      }
    >
      {error ? (
        <div className="notice notice-bad"><span>{error}</span></div>
      ) : !url ? (
        <p className="field-hint">Loading…</p>
      ) : isImage ? (
        <img
          src={url}
          alt={attachment.name}
          style={{ width: "100%", maxHeight: "70vh", objectFit: "contain", borderRadius: 8, background: "var(--surface-3)" }}
        />
      ) : (
        /* Sandboxed: a PDF is somebody else's file, and it renders inside the
           app's own page. Nothing in it should be able to script or navigate
           the window around it. */
        <iframe
          title={attachment.name}
          src={url}
          sandbox=""
          style={{ width: "100%", height: "70vh", border: "1px solid var(--rule)", borderRadius: 8, background: "#fff" }}
        />
      )}
    </Modal>
  );
}
