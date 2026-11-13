import type { ArmedStep } from "../../data/followups";
import {
  buildEmailHtml, buildEmailText,
  type EmailCompany, type EmailQuotation, type EmailSender,
} from "../../domain/integrations/emailTemplate";
import {
  followUpBody, followUpSubject, type FollowUpFacts, type FollowUpTone,
} from "../../domain/followups/followups";
import { templateFor } from "../../domain/integrations/interakt";

/**
 * Everything arming a sequence needs to know about the document it chases.
 *
 * ONE DEFINITION, shared by the email dialog's prop and the builder, so a
 * field added here cannot be forgotten on the other side.
 */
export type Armable = {
  ownerId: string;
  docType: "quotation" | "proforma";
  docId: string;
  docNumber: string;
  customerId?: string;
  customerName: string;
  facts: FollowUpFacts;
  plan: Array<{ step: number; tone: FollowUpTone; dueOn: string }>;
  /** Where a WhatsApp follow-up would go, or why it cannot. */
  whatsapp: { to: string; why: string };
  /** The names these templates were approved under in Meta. */
  templateNames: Partial<Record<FollowUpTone, string>>;
  company: string;
};


/**
 * The messages a follow-up sequence will send, rendered now and stored.
 *
 * WHY THEY ARE BUILT AT ARMING TIME and not when they go out: what was
 * queued is what the customer receives. A chaser re-templated weeks later
 * by code nobody watched is a message nobody approved.
 *
 * EXTRACTED SO THAT ARMING DOES NOT DEPEND ON THE EMAIL DIALOG. It used to
 * live inside the dialog's send handler, which meant a sequence could only
 * ever be armed by emailing from inside the CRM — and a salesperson who
 * downloads the PDF and sends it from Outlook, which is most of them, got
 * no follow-ups at all. Same builder, two callers.
 */
export function buildArmedSteps({
  armable, sender, company, quotation, channels,
}: {
  armable: Armable;
  sender: EmailSender;
  company: EmailCompany;
  quotation?: EmailQuotation | null;
  channels: { email: boolean; whatsapp: boolean };
}): ArmedStep[] {
  return armable.plan.flatMap((p) => {
        const rows: ArmedStep[] = [];
        const base = { step: p.step, steps: armable.plan.length, tone: p.tone, dueOn: p.dueOn };

        if (channels.email) {
          /* NO GREETING ON THESE, deliberately. They are rendered now
             and sent weeks later, by which time the festival is over —
             a chaser arriving in December wishing somebody a happy
             Diwali is the exact failure the dated window exists to
             prevent. The one typed in the Follow up dialog goes out
             today and does carry it. */
          rows.push({
            ...base,
            channel: "email",
            subject: followUpSubject(p.tone, armable.facts),
            message: buildEmailText({
              body: followUpBody(p.tone, armable.facts),
              sender, company, quotation, attachmentName: null,
            }),
            /* Rendered NOW, from the same builder the preview uses, and
               stored. What goes out weeks later is this exact markup —
               not something re-templated by code nobody watched. */
            html: buildEmailHtml({
              body: followUpBody(p.tone, armable.facts),
              sender, company, quotation, attachmentName: null,
            }),
          });
        }

        if (channels.whatsapp && armable.whatsapp.to) {
          /* The template and its placeholder values are decided here and
             stored, for the same reason the email markup is: what was
             queued is what goes out. The WORDS are Meta's, in the
             approved template — nothing here can change them. */
          const t = templateFor(p.tone, {
            contact: armable.facts.contact,
            company: armable.company,
            number: armable.facts.number,
            date: armable.facts.date,
            validUntil: armable.facts.validUntil,
          }, armable.templateNames);
          rows.push({
            ...base,
            channel: "whatsapp",
            toPhone: armable.whatsapp.to,
            templateName: t.templateName,
            templateValues: [...t.bodyValues],
          });
        }

return rows;
  });
}
