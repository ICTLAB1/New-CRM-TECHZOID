import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Field, Input, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { renderSignature, signatureFrom, type SignatureBadge } from "../../domain/outreach/signature";

/**
 * The signature at the foot of every outreach email.
 *
 * MOST OF IT IS ALREADY IN SETTINGS — the company name, the tagline, both
 * offices, the phone numbers, the website, the logo — and this panel does not
 * ask for any of it again. Two copies of a company address is one copy that
 * goes stale, and the one that goes stale is always the one somebody is
 * reading. What is here is only the parts a signature needs and nothing else
 * does: the credentials line, the partner badges, and the disclaimer.
 *
 * THE BADGES ARE UPLOADED, NOT DRAWN. Microsoft's, Adobe's and Cisco's marks
 * belong to them and are issued to partners as artwork; this CRM will render
 * a badge somebody supplies and will never produce one. The label beside each
 * is what a recipient sees when their mail client blocks images, which is the
 * default in Outlook.
 */

/** Kept small deliberately: every badge is a data URI carried in every
 *  message this company sends, and three of them at 200 KB each is 600 KB on
 *  the wire per email. */
const MAX_BADGE_DATA_URI = 120_000;

interface SignatureSettings {
  credentials?: string;
  disclaimer?: string;
  badges?: SignatureBadge[];
}

export function SignaturePanel({
  settings, canEdit, currentUser, onChange,
}: {
  settings: Record<string, unknown>;
  canEdit: boolean;
  currentUser: { name?: string; email?: string; designation?: string };
  onChange: (s: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const stored = (settings["emailSignature"] ?? {}) as SignatureSettings;
  const fileInput = useRef<HTMLInputElement>(null);
  const [badgeError, setBadgeError] = useState("");

  /* Local draft, saved explicitly — the same shape the sibling panels use.
     Uploading a badge and having it appear in every email before anybody
     pressed Save would be a nasty surprise. */
  const asDraft = (v: SignatureSettings) => ({
    credentials: String(v.credentials ?? ""),
    disclaimer: String(v.disclaimer ?? ""),
    badges: (v.badges ?? []) as SignatureBadge[],
  });

  const [draft, setDraft] = useState(() => asDraft(stored));
  const saved = JSON.stringify(asDraft(stored));
  const dirty = JSON.stringify(draft) !== saved;

  /* Adopt a change that came from somewhere else — a restore, or another
     tab — but only while there is nothing of the user's own to lose. */
  useEffect(() => {
    if (!dirty) setDraft(asDraft(stored));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const save = () => onChange({ ...settings, emailSignature: draft });
  const reset = () => setDraft(asDraft(stored));

  /* The preview renders through the same function the server uses, and a
     parity test pins the two together — so what is shown here is what
     arrives, not an approximation of it. */
  const html = useMemo(
    () => renderSignature(signatureFrom({ ...settings, emailSignature: draft }, currentUser)),
    [settings, draft, currentUser],
  );

  function addBadge(file: File) {
    setBadgeError("");
    const reader = new FileReader();
    reader.onerror = () => setBadgeError("Couldn't read that file. Try saving it again and re-picking it.");
    reader.onload = () => {
      const src = String(reader.result ?? "");
      if (src.length > MAX_BADGE_DATA_URI) {
        setBadgeError(
          `That image is about ${Math.round(src.length / 1024)} KB encoded, which is too big for ` +
          "something that rides along on every email. Around 100 KB or less — a badge shows at 110px wide.",
        );
        return;
      }
      const img = new Image();
      img.onerror = () => setBadgeError("That file doesn't look like an image the browser can read.");
      img.onload = () => {
        setDraft((d) => ({
          ...d,
          badges: [...d.badges, {
            src,
            label: file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "),
            width: Math.min(120, img.naturalWidth),
            height: img.naturalHeight,
          }],
        }));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  const setBadge = (i: number, patch: Partial<SignatureBadge>) =>
    setDraft((d) => ({ ...d, badges: d.badges.map((b, n) => (n === i ? { ...b, ...patch } : b)) }));

  const removeBadge = (i: number) =>
    setDraft((d) => ({ ...d, badges: d.badges.filter((_, n) => n !== i) }));

  return (
    <div className="stack">
      <Card title="What the company does" padded>
        <Field
          label="Credentials line"
          hint="One line, shown in bold under the contact details. Separate with | — for example: Enterprise Software Licensing | Microsoft | Adobe | Autodesk | Cloud | Cybersecurity"
        >
          <Input
            value={draft.credentials}
            disabled={!canEdit}
            placeholder="Enterprise Software Licensing | Microsoft | Adobe | Autodesk | Cloud | Cybersecurity"
            onChange={(e) => setDraft((d) => ({ ...d, credentials: e.target.value }))}
          />
        </Field>
        <p className="muted small" style={{ margin: 0 }}>
          The name, tagline, logo, both office addresses, phone numbers and website all come from the
          Company tab — they are not asked for again here, because two copies of an address is one
          copy that goes stale.
        </p>
      </Card>

      <Card title="Partner badges" padded>
        <p className="muted small" style={{ marginTop: 0 }}>
          Upload the badge artwork the partner programmes issued you. This CRM will show a badge you
          supply and will never generate one — those marks belong to Microsoft, Adobe and the rest.
          The label is what a recipient sees when their mail client blocks images, which Outlook does
          by default.
        </p>

        {draft.badges.length ? (
          <table className="table compact">
            <thead><tr><th>Badge</th><th>Label</th><th>Width</th><th /></tr></thead>
            <tbody>
              {draft.badges.map((b, i) => (
                <tr key={i}>
                  <td style={{ width: 140 }}>
                    <img src={b.src} alt={b.label} style={{ maxWidth: 120, height: "auto", display: "block" }} />
                  </td>
                  <td>
                    <Input
                      value={b.label}
                      disabled={!canEdit}
                      onChange={(e) => setBadge(i, { label: e.target.value })}
                    />
                  </td>
                  <td style={{ width: 110 }}>
                    <Input
                      numeric
                      value={String(b.width ?? 90)}
                      disabled={!canEdit}
                      onChange={(e) => setBadge(i, { width: Math.max(40, Math.min(120, Number(e.target.value) || 90)) })}
                    />
                  </td>
                  <td className="num">
                    <Button tone="quiet" disabled={!canEdit} onClick={() => removeBadge(i)}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted" style={{ margin: "0 0 12px" }}>No badges yet.</p>
        )}

        {badgeError ? <p className="small" style={{ color: "#b91c1c" }}>{badgeError}</p> : null}

        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) addBadge(file);
            e.target.value = "";
          }}
        />
        <Button disabled={!canEdit} onClick={() => fileInput.current?.click()}>Add a badge</Button>
      </Card>

      <Card title="Disclaimer" padded>
        <Field
          label="Shown in red at the foot"
          hint="Leave blank for none. Legal boilerplate, which is exactly why it is editable rather than written into the code."
        >
          <Textarea
            rows={3}
            value={draft.disclaimer}
            disabled={!canEdit}
            placeholder="No employee or agent is authorized to conclude any binding agreement on behalf of the company by email without specific confirmation."
            onChange={(e) => setDraft((d) => ({ ...d, disclaimer: e.target.value }))}
          />
        </Field>
      </Card>

      <Card title="How it will look" padded>
        <p className="muted small" style={{ marginTop: 0 }}>
          Rendered by the same code that builds the email, with your own name and job title.
        </p>
        <div
          style={{ border: "1px solid var(--rule, #e5e7eb)", borderRadius: 6, padding: 16, background: "#fff" }}
          /* The HTML is produced by renderSignature from this workspace's own
             settings — every value escaped, every image source checked. It is
             not somebody else's markup being trusted. */
          dangerouslySetInnerHTML={{ __html: html || "<em>Nothing to show yet.</em>" }}
        />
      </Card>

      {canEdit ? (
        <div className="row-tight">
          <Button tone="primary" disabled={!dirty} onClick={() => { save(); toast("Signature saved", "good"); }}>
            Save
          </Button>
          <Button disabled={!dirty} onClick={reset}>Discard</Button>
        </div>
      ) : null}
    </div>
  );
}
