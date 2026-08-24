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
      { id: "dashboard", label: "Dashboard" },
      { id: "pipeline", label: "Pipeline" },
      { id: "customers", label: "Customers" },
      { id: "quotations", label: "Quotations" },
      { id: "proformas", label: "Proformas", badge: 3 },
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
      { id: "renewals", label: "Renewals", badge: 7 },
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
      { id: "team", label: "Team" },
      { id: "integrations", label: "Integrations" },
      { id: "settings", label: "Settings" },
      { id: "components", label: "Components" },
    ],
  },
];
