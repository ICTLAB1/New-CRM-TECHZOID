import { useEffect, useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, Field, Input, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { whatsappLink } from "../../domain/integrations/phone";
import { isLeadCode, leadLink } from "../../domain/leads/link";
import { myLeadCode } from "../../data/leadCode";
import { IntegrationError, type IntegrationsApi } from "../../integrations/api";
import {
  buildEmailHtml, buildEmailText,
  type EmailCompany, type EmailSender,
} from "../../domain/integrations/emailTemplate";

/**
 * A salesperson's own registration link.
 *
 * Anyone who fills it in lands as a lead in this person's pipeline, with the
 * billing details and GSTIN already typed — by the customer, who knows them —
 * instead of read out over a phone call and typed twice.
 *
 * The link is SHORT. It used to carry the salesperson's uuid, which made 36
 * characters of hexadecimal that nobody could read out, that wrapped badly
 * in a WhatsApp message, and that put an internal identifier in front of
 * every customer who was sent one. Six characters now. The old links still
 * resolve and always will — see src/domain/leads/link.ts.
 */

const PITCH =
  "Hi! Please register your details here — including your GSTIN if applicable — " +
  "so I can prepare an accurate quotation for you: ";

export function ShareLinkDialog({
  open, user, api, settings, onClose,
}: {
  open: boolean;
  user: { id: string; name: string; email?: string; designation?: string };
  api?: IntegrationsApi;
  settings?: Record<string, unknown>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [emailing, setEmailing] = useState(false);

  /* Minted on first use rather than at sign-up: most people never share a
     link, and a code allocated for everybody is a column of noise. */
  useEffect(() => {
    if (!open) return;
    let live = true;
    myLeadCode().then((value) => { if (live) setCode(value); }).catch(() => {});
    return () => { live = false; };
  }, [open]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = leadLink(origin, code, user.id);
  const message = PITCH + link;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied", "good");
    } catch {
      toast("Couldn't copy — select the link and copy it manually", "warn");
    }
  };

  return (
    <>
    <Modal
      /* One dialog on screen at a time. A modal opened inside another stacks
         two scrims and two Escape handlers, and Escape then closes both —
         which is why the panel's own "discard?" guard is drawn inside it
         rather than as a second dialog. Stepping to the email form hides
         this one; cancelling there brings it back. */
      open={open && !emailing}
      title="Your customer registration link"
      description="Share this instead of typing a customer's details out yourself."
      onClose={onClose}
      footer={<Button tone="quiet" onClick={onClose}>Done</Button>}
    >
      <div className="stack">
        <p style={{ margin: 0 }}>
          It asks for everything a proper quotation needs — company, billing address, GSTIN and PAN — and the
          moment it's submitted it appears in your customer list, ready to quote. The customer needs no
          account and no sign-in.
        </p>

        <div className="row-tight">
          <Input
            className="mono"
            readOnly
            value={link}
            style={{ flex: 1 }}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button tone="primary" onClick={() => void copy()}>Copy</Button>
        </div>

        {/* SAYS SO RATHER THAN JUST BEING LONG. A short code has to be minted
            by the database, and until that update has been run there is
            nothing to mint it — which from here looks identical to the
            feature never having been built. */}
        {!isLeadCode(code) ? (
          <p className="field-hint" style={{ margin: 0 }}>
            Short links aren't switched on yet — an admin needs to run the latest database update.
            This link works exactly the same in the meantime; it is only longer.
          </p>
        ) : null}

        <div className="row-tight wrap">
          <a
            className="btn btn-default btn-sm"
            href={whatsappLink("", message)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Share on WhatsApp
          </a>
          {/* Sends from here, from this person's own mailbox, rather than
              handing the job to whatever mail client the machine happens to
              have configured — which on a shared desktop is frequently
              nobody's. */}
          <Button size="sm" tone="default" onClick={() => setEmailing(true)}>Send by email</Button>
        </div>

        <div className="notice notice-flat">
          <span>
            Everything submitted through your link is attributed to you automatically, and shows in your list
            with “Customer Registration Form” as the source.
          </span>
        </div>
      </div>

    </Modal>

    <SendLinkDialog
      open={open && emailing}
      api={api}
      user={user}
      settings={settings ?? {}}
      link={link}
      onBack={() => setEmailing(false)}
      onSent={() => { setEmailing(false); onClose(); }}
    />
    </>
  );
}

/* ── sending it ────────────────────────────────────────────────────── */

/**
 * Email the link to a customer, from the salesperson's own address.
 *
 * Built through the same email builder as a quotation, so the first thing
 * this customer ever receives from the company looks like everything that
 * follows it — rather than like a bare URL pasted into a blank message.
 */
function SendLinkDialog({
  open, api, user, settings, link, onBack, onSent,
}: {
  open: boolean;
  api?: IntegrationsApi;
  user: { id: string; name: string; email?: string; designation?: string };
  settings: Record<string, unknown>;
  link: string;
  /** Back to the link, with nothing sent. */
  onBack: () => void;
  /** Sent — so the whole thing closes rather than dropping the person back
   *  onto a link they have just finished with. */
  onSent: () => void;
}) {
  const toast = useToast();
  const [to, setTo] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const companySettings = (settings["company"] ?? {}) as Record<string, unknown>;
  const companyName = String(companySettings["name"] ?? "");

  const sender: EmailSender = {
    name: user.name,
    email: user.email ?? "",
    designation: user.designation ?? "",
  };

  const company: EmailCompany = {
    name: companyName,
    tagline: String(companySettings["tagline"] ?? ""),
    website: String(companySettings["website"] ?? ""),
    phone: String(companySettings["phone"] ?? ""),
    email: String(companySettings["email"] ?? ""),
    addressLines: [],
    gstin: String(companySettings["gstin"] ?? ""),
    pan: String(companySettings["pan"] ?? ""),
    cin: String(companySettings["cin"] ?? ""),
  };

  /* Named where we have a name, and no greeting at all where we do not —
     "Dear Sir/Madam" announces that the sender did not know who they were
     writing to, which is a poor first line to a new customer. */
  const body = [
    name.trim() ? `Dear ${name.trim()},` : "",
    `Before I prepare a quotation, could you register your details here?`,
    link,
    "It takes a minute, and it asks for the billing address and GSTIN so the quotation and the invoice that follows it are right first time. There is no account to create and nothing to sign in to.",
    "",
    "Best regards,",
    user.name,
  ].filter((line, i, all) => !(line === "" && (i === 0 || all[i - 1] === ""))).join("\n\n");

  const subject = companyName
    ? `Registration link — ${companyName}`
    : "Please register your details";

  const send = async () => {
    if (!api) return;
    setError("");
    setBusy(true);
    try {
      const content = { body, sender, company, quotation: null, attachmentName: null };
      const result = await api.sendEmail({
        to: to.trim(),
        subject,
        message: buildEmailText(content),
        html: buildEmailHtml(content),
        replyTo: user.email || undefined,
      });
      toast(result.via === "microsoft" && result.from ? "Sent from " + result.from : "Link sent", "good");
      setTo("");
      setName("");
      onSent();
    } catch (err) {
      setError(err instanceof IntegrationError ? err.message : "Couldn't send that email.");
    }
    setBusy(false);
  };

  return (
    <Modal
      open={open}
      title="Send the link by email"
      description={
        sender.email
          ? `Goes out as ${sender.email}. Replies come back to you.`
          : "Sent from your own mailbox when one is connected, otherwise from the company address."
      }
      unsavedChanges={!!to.trim() && !busy}
      onClose={onBack}
      footer={
        <>
          <Button tone="quiet" onClick={onBack}>Back</Button>
          <Button tone="primary" disabled={busy || !to.trim() || !api} onClick={() => void send()}>
            {busy ? "Sending…" : "Send"}
          </Button>
        </>
      }
    >
      <div className="stack">
        {!api ? (
          <p className="field-hint" style={{ margin: 0 }}>
            Sending needs a signed-in workspace. This preview has nowhere to send from.
          </p>
        ) : null}

        <div className="grid grid-2">
          <Field label="Customer's email">
            <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="buyer@company.com" />
          </Field>
          <Field label="Their name" hint="Optional — used for the greeting.">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>

        <Field label="What they will read" hint="Your signature and the company details are added underneath.">
          <Textarea rows={8} readOnly value={body} />
        </Field>

        {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}
      </div>
    </Modal>
  );
}
