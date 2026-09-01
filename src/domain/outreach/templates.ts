import type { Block } from "./emailHtml";

/**
 * The library of first-contact and follow-up emails.
 *
 * WHAT THESE ARE WRITTEN TO DO. Start a conversation about licensing with
 * somebody who has never heard of us — not to sell in one email, which does
 * not happen and reads badly when attempted. An IT Manager gets a dozen of
 * these a week; the ones that get replies are short, specific, obviously
 * written by a person, and easy to ignore without feeling pushed.
 *
 * WHAT IS DELIBERATELY ABSENT, and it is most of what bulk-mail tools do:
 *
 *   · no urgency — "limited time", "act now", "before it expires"
 *   · no fake scarcity or invented deadlines
 *   · no promised numbers — "save 30%", "guaranteed savings". We do not know
 *     what they pay, and a claim we cannot stand behind ends the
 *     relationship the moment they check it
 *   · no flattery about a company we have not researched
 *   · no "just checking in" with nothing added — every follow-up carries a
 *     reason to exist
 *   · no ALL CAPS, no exclamation marks, no "Dear Sir/Madam"
 *
 * The close is always a question that is easy to answer and easy to decline.
 * A first email asking for a meeting is asking a stranger for an hour.
 *
 * MARKERS, not HTML: **bold**, _italic_, [text](https://…). See emailHtml.ts.
 */

export type TemplateCategory =
  | "Introduction" | "Microsoft" | "Adobe" | "Autodesk"
  | "Renewal" | "Procurement" | "Follow-up" | "Enterprise" | "Government" | "IT Services";

export interface EmailTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** Who it is written for, shown when picking. */
  audience: string;
  subject: string;
  preheader: string;
  blocks: Block[];
  /** Where it sits in a sequence: 0 is first contact. */
  step: number;
  /** Business days to wait before this one, when used in a sequence. */
  waitDays?: number;
}

const SIGNATURE: Block = { kind: "signature", text: "{{sender_signature}}" };

export const TEMPLATES: EmailTemplate[] = [
  {
    id: "intro-general",
    name: "Introduction — general IT decision maker",
    category: "Introduction",
    audience: "CIO, CTO, IT Head, Admin Head",
    step: 0,
    subject: "Software licensing for {{company_name}}",
    preheader: "A quick introduction from {{sender_company}} — Microsoft, Adobe and Autodesk licensing.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "I am {{sender_name}} from **{{sender_company}}**. We supply and support software licensing for businesses across India and the UAE — mainly **Microsoft**, **Adobe** and **Autodesk**, along with the procurement and renewal paperwork that goes with them." },
      { kind: "paragraph", text: "I am writing because most companies your size are managing licences across several vendors with renewals falling in different months, and it is rarely anybody's full-time job to keep track of it." },
      { kind: "paragraph", text: "If it would be useful, I can put together a short summary of what your current agreements cover and where the renewal dates fall. No obligation — plenty of people find it clarifying even if they stay where they are." },
      { kind: "paragraph", text: "Would that be worth a look? And if licensing sits with somebody else at {{company_name}}, I would be grateful for a pointer." },
      SIGNATURE,
    ],
  },
  {
    id: "intro-it-manager",
    name: "Introduction — IT Manager / IT Head",
    category: "Introduction",
    audience: "IT Manager, IT Head, System Administrator",
    step: 0,
    subject: "Microsoft and Adobe licensing — {{company_name}}",
    preheader: "Licensing support for IT teams in India and the UAE.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "{{sender_name}} here from **{{sender_company}}**. We handle Microsoft, Adobe and Autodesk licensing for companies in India and the UAE — the supply side, and the parts that usually land on IT rather than procurement:" },
      { kind: "bullets", items: [
        "Working out which plan actually covers what your team uses",
        "Renewal dates in one place instead of across three vendor portals",
        "True-ups and seat changes without a three-week email chain",
      ] },
      { kind: "paragraph", text: "Nothing to action today. If you have a renewal coming up, or a licence question that has been sitting on your list, I am happy to look at it — whether or not it turns into anything." },
      { kind: "paragraph", text: "What are you running at the moment?" },
      SIGNATURE,
    ],
  },
  {
    id: "intro-procurement",
    name: "Introduction — Procurement / Purchase Manager",
    category: "Procurement",
    audience: "Procurement Manager, Purchase Manager, Finance",
    step: 0,
    subject: "Licensing quotations for {{company_name}}",
    preheader: "Formal quotations, GST invoicing, India and UAE.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "I am {{sender_name}} from **{{sender_company}}**. We supply Microsoft, Adobe and Autodesk licensing, and I wanted to introduce us as a vendor you could put on your list for comparison." },
      { kind: "paragraph", text: "Practically, that means:" },
      { kind: "bullets", items: [
        "Formal quotations against your specification, usually the same or next working day",
        "GST-compliant invoicing in India and VAT invoicing in the UAE",
        "Purchase orders, proformas and delivery documentation in the format your process needs",
      ] },
      { kind: "paragraph", text: "If you have a requirement open now I am glad to quote it. If not, keeping us on file for the next comparison is fine too." },
      { kind: "paragraph", text: "Who should I send a company profile and vendor details to?" },
      SIGNATURE,
    ],
  },
  {
    id: "intro-enterprise",
    name: "Introduction — enterprise",
    category: "Enterprise",
    audience: "Large organisations, multiple sites or countries",
    step: 0,
    subject: "Licensing across India and the UAE — {{company_name}}",
    preheader: "Multi-entity licensing, one point of contact.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "{{sender_name}} from **{{sender_company}}**. We work with organisations that hold licensing across more than one entity or country — which, in our experience, is where most of the difficulty actually sits." },
      { kind: "paragraph", text: "Where we tend to be useful:" },
      { kind: "bullets", items: [
        "One contact covering both Indian and UAE entities, instead of separate vendors either side",
        "Renewals aligned to a common date rather than scattered across the year",
        "Consolidated reporting for finance, and invoicing in the right entity and currency",
      ] },
      { kind: "paragraph", text: "If a review of how your agreements are structured would be useful, I am happy to go through it with your team. If the timing is wrong, tell me roughly when and I will come back then rather than chase." },
      SIGNATURE,
    ],
  },
  {
    id: "followup-1",
    name: "Follow-up 1 — short nudge",
    category: "Follow-up",
    audience: "Anyone who did not reply to the introduction",
    step: 1,
    waitDays: 3,
    subject: "Re: Software licensing for {{company_name}}",
    preheader: "Following up briefly.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "Following up on my note last week about licensing at {{company_name}} — I know this sort of thing rarely sits at the top of the list." },
      /* Carries something the first email did not, and offers an exit. A
         chaser that only repeats itself trains people to ignore the sender. */
      { kind: "paragraph", text: "One thing worth mentioning: if any of your Microsoft or Adobe renewals fall in the next quarter, that is usually the point where changes are easiest to make. Happy to check the dates with you if that would help." },
      { kind: "paragraph", text: "If this is not relevant, just say so and I will leave it there." },
      SIGNATURE,
    ],
  },
  {
    id: "followup-2-value",
    name: "Follow-up 2 — something useful",
    category: "Follow-up",
    audience: "Still no reply after the first follow-up",
    step: 2,
    waitDays: 5,
    subject: "Licence renewals — a quick note",
    preheader: "Two things worth knowing before your next renewal.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "I will not keep writing about this, but two things come up often enough with licensing that they are worth passing on whether or not you ever buy from us:" },
      { kind: "numbers", items: [
        "Seat counts drift. Most organisations are paying for a number set at the last renewal rather than the number in use now — worth checking before you renew, not after.",
        "Renewal dates are easier to move at renewal than at any other point. If yours are scattered across the year, that is the moment to align them.",
      ] },
      { kind: "paragraph", text: "If either is useful and you want a hand looking at it, I am here. If not, that is genuinely fine." },
      SIGNATURE,
    ],
  },
  {
    id: "requirement-check",
    name: "Requirements check",
    category: "Follow-up",
    audience: "Somebody who showed interest but sent no specification",
    step: 0,
    subject: "Details for your quotation — {{company_name}}",
    preheader: "A few details and I can get this quoted.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "Thank you for coming back to me. To put an accurate quotation together, could you confirm:" },
      { kind: "numbers", items: [
        "Which product and edition — and the version, if it matters to you",
        "How many users or seats",
        "Term: monthly, annual, or a three-year commitment",
        "The billing entity and country, so the invoice is raised correctly",
      ] },
      { kind: "paragraph", text: "If you are not certain on any of it, send what you have and I will come back with options rather than hold things up." },
      SIGNATURE,
    ],
  },
  {
    id: "renewal-reminder",
    name: "Renewal reminder",
    category: "Renewal",
    audience: "An existing customer with a renewal approaching",
    step: 0,
    subject: "Renewal coming up — {{company_name}}",
    preheader: "Your licences are due for renewal shortly.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "Your licences are due for renewal shortly, so I wanted to give you time rather than send this the week before." },
      { kind: "paragraph", text: "Before we renew as-is, two things are worth a moment:" },
      { kind: "bullets", items: [
        "**Seat count** — has the team grown or shrunk since last time?",
        "**Edition** — features move between plans, and what you needed last year may now sit in a cheaper one, or a dearer one",
      ] },
      { kind: "paragraph", text: "Tell me if anything has changed and I will send a revised quotation. If everything is the same, say so and I will process the renewal as it stands." },
      SIGNATURE,
    ],
  },
  {
    id: "microsoft-enquiry",
    name: "Microsoft licensing enquiry",
    category: "Microsoft",
    audience: "Someone evaluating Microsoft 365 or Azure",
    step: 0,
    subject: "Microsoft 365 licensing — {{company_name}}",
    preheader: "Plan comparison and pricing for Microsoft 365.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "{{sender_name}} from **{{sender_company}}**. We supply Microsoft licensing — Microsoft 365, Windows, Office, and Azure — for companies in India and the UAE." },
      { kind: "paragraph", text: "Where people usually want help is the plan comparison: Business Standard against Business Premium, or E3 against E5, and whether the security features in the higher tier are ones you would actually use. It is a genuinely awkward comparison and the vendor's own pages do not make it easier." },
      { kind: "paragraph", text: "If you are looking at this now, I can put the options side by side against how your team works. What are you weighing up?" },
      SIGNATURE,
    ],
  },
  {
    id: "adobe-enquiry",
    name: "Adobe licensing enquiry",
    category: "Adobe",
    audience: "Design, marketing and documentation teams",
    step: 0,
    subject: "Adobe licensing for {{company_name}}",
    preheader: "Creative Cloud and Acrobat licensing for teams.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "{{sender_name}} from **{{sender_company}}**. We supply Adobe licensing — Creative Cloud for teams, Acrobat, and the single-application plans — across India and the UAE." },
      { kind: "paragraph", text: "The question we are asked most is whether a team needs the full Creative Cloud or whether single-app licences cover it. For a lot of teams a mix works out considerably better, and it is worth checking before renewing everyone on the same plan." },
      { kind: "paragraph", text: "If that is a live question for you, I am happy to look at it. How is your team set up at the moment?" },
      SIGNATURE,
    ],
  },
  {
    id: "autodesk-enquiry",
    name: "Autodesk licensing enquiry",
    category: "Autodesk",
    audience: "Engineering, architecture, manufacturing, construction",
    step: 0,
    subject: "Autodesk licensing — {{company_name}}",
    preheader: "AutoCAD, Revit and the industry collections.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "{{sender_name}} from **{{sender_company}}**. We supply Autodesk licensing — AutoCAD, Revit, Inventor and the industry collections — for firms in India and the UAE." },
      { kind: "paragraph", text: "Two things come up repeatedly: whether an industry collection works out better than separate products once you count what the team actually opens, and how to handle people who need a seat for part of the year rather than all of it." },
      { kind: "paragraph", text: "If either is on your mind, I am glad to go through it. What is your team using?" },
      SIGNATURE,
    ],
  },
  {
    id: "followup-final",
    name: "Final follow-up — closing the loop",
    category: "Follow-up",
    audience: "The last email in a sequence",
    step: 3,
    waitDays: 7,
    subject: "Closing the loop",
    preheader: "Last note from me on this.",
    blocks: [
      { kind: "paragraph", text: "Hello {{first_name}}," },
      { kind: "paragraph", text: "I have written a couple of times about licensing at {{company_name}} and have not heard back, which almost always means the timing is wrong rather than anything else." },
      /* Ends the sequence properly. A last email that leaves the door open
         without asking for anything is the one people remember well enough
         to answer months later. */
      { kind: "paragraph", text: "I will stop here rather than keep filling your inbox. If licensing comes up later — a renewal, a new requirement, or a quotation you want compared — my details are below and I am glad to help then." },
      { kind: "paragraph", text: "Thanks for your time, and good luck with the rest of it." },
      SIGNATURE,
    ],
  },
];

/** The default sequence: introduction, then three follow-ups that each add
 *  something, spaced so they never arrive on consecutive days. */
export const DEFAULT_SEQUENCE = ["intro-general", "followup-1", "followup-2-value", "followup-final"] as const;

export const byId = (id: string): EmailTemplate | undefined => TEMPLATES.find((t) => t.id === id);

export const byCategory = (category: TemplateCategory): EmailTemplate[] =>
  TEMPLATES.filter((t) => t.category === category);

export const CATEGORIES: TemplateCategory[] = [
  "Introduction", "Microsoft", "Adobe", "Autodesk", "Renewal",
  "Procurement", "Follow-up", "Enterprise", "Government", "IT Services",
];
