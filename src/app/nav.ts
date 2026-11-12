export interface NavItem {
  id: string;
  label: string;
  /** A count worth interrupting for — overdue, due today. Not a total. */
  badge?: number;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/** Grouped by what a person is doing, not by which table it lives in. */
export const NAV: NavSection[] = [
  {
    label: "Sell",
    items: [
      { id: "dashboard", label: "Home" },
      { id: "tasks", label: "Tasks" },
      /* An action rather than a place, and it is here because it is how
         somebody holding a printed document gets to the record: point the
         camera at the square on the page. A phone is the only device this
         is ever done on, which is why it is not a header button — the
         header is where a phone has the least room. */
      { id: "scan", label: "Scan a document" },
      { id: "pipeline", label: "Pipeline" },
      { id: "customers", label: "Customers" },
      { id: "mail", label: "Mail" },
      { id: "quotations", label: "Quotations" },
      { id: "proformas", label: "Proformas" },
    ],
  },
  {
    /* Before "Sell" would be wrong — this is where deals come from, but a
       salesperson opens the CRM to work the pipeline, not to import a list.
       Its own group because outreach is a different job from selling to
       somebody who has already replied. */
    label: "Find",
    items: [
      { id: "prospects", label: "Prospects" },
      { id: "campaigns", label: "Campaigns" },
    ],
  },
  {
    label: "Buy",
    items: [
      { id: "purchase-orders", label: "Purchase orders" },
    ],
  },
  {
    label: "Deliver",
    items: [
      { id: "orders", label: "Sales orders" },
      { id: "dispatch", label: "Dispatch" },
      { id: "subscriptions", label: "Subscriptions" },
      { id: "renewals", label: "Renewals" },
    ],
  },
  {
    label: "Get paid",
    items: [
      { id: "invoices", label: "Tax invoices" },
      { id: "receivables", label: "Receivables" },
    ],
  },
  {
    /* Its own section on purpose: bills on credit entered by hand, with
       automatic reminders. Separate from the CRM's invoices and
       Receivables, and shares no data with them. */
    label: "Collect",
    items: [
      { id: "payment-tracker", label: "Payment Tracker" },
    ],
  },
  {
    label: "Understand",
    items: [
      { id: "reports", label: "Reports" },
      { id: "activity", label: "Activity" },
      { id: "assistant", label: "Assistant" },
      { id: "incentives", label: "Incentives" },
    ],
  },
  {
    label: "Administer",
    items: [
      { id: "catalog", label: "Product catalog" },
      /* Next to the catalog and not in "Sell", although a BDE reads it
         every day: the way they read it is the price book picker inside the
         quotation editor, not by coming here. Visiting this screen is
         mostly an administrative act — loading the month's OEM list and
         setting the minimum margins — so it sits with the other ones.
         A BDE who does come here gets the search and the minimum selling
         price, and no tab that would show them a cost. */
      { id: "price-book", label: "Price book" },
      /* The approvals queue. Beside the price book because it is the other
         half of the same rule: the price book sets the floor and this is
         where going below it is decided. The badge is live — a request
         waiting is somebody's quotation that cannot be sent. */
      { id: "discount-approvals", label: "Discount approvals" },
      { id: "team", label: "Team" },
      /* Team is who can sign in; Companies is which business each of them
         works in, and with what authority there. Neighbours because that is
         the order somebody does them in. */
      { id: "companies", label: "Companies" },
      { id: "integrations", label: "Integrations" },
      { id: "settings", label: "Settings" },
      { id: "components", label: "Components" },
    ],
  },
];
