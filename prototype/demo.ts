/**
 * DEMO DATA — entirely fictional.
 *
 * Every company, person, phone number and email below is invented for this
 * prototype. None of it is, or resembles, a real TechZoid customer record.
 * The banner across the top of every screen says so, so a screenshot that
 * escapes this folder cannot be mistaken for the live workspace.
 */

export const DEMO_BANNER = "Demo data — fictional records for design review. Not the live workspace.";

export type Stage = "new" | "qualified" | "contacted" | "requirement" | "proposal" | "negotiation" | "won" | "lost";

export const STAGES: { id: Stage; label: string; tone: "neutral" | "accent" | "warn" | "good" | "bad"; probability: number }[] = [
  { id: "new",         label: "Lead",                  tone: "neutral", probability: 10 },
  { id: "qualified",   label: "Qualified",             tone: "accent",  probability: 25 },
  { id: "contacted",   label: "Contacted",             tone: "accent",  probability: 35 },
  { id: "requirement", label: "Requirement Identified",tone: "accent",  probability: 50 },
  { id: "proposal",    label: "Proposal Sent",         tone: "warn",    probability: 65 },
  { id: "negotiation", label: "Negotiation",           tone: "warn",    probability: 80 },
  { id: "won",         label: "Won",                   tone: "good",    probability: 100 },
  { id: "lost",        label: "Lost",                  tone: "bad",     probability: 0 },
];
export const stage = (id: Stage) => STAGES.find((s) => s.id === id)!;
export const PIPELINE_STAGES = STAGES.filter((s) => s.id !== "won" && s.id !== "lost");

export const USERS = [
  { id: "u1", name: "Abhinav Jain",     role: "Director",        initials: "AJ", target: 18000000 },
  { id: "u2", name: "Priyanshi Sharma", role: "Sales Manager",   initials: "PS", target: 9000000 },
  { id: "u3", name: "Rashmi Nair",      role: "Sales Executive", initials: "RN", target: 6000000 },
  { id: "u4", name: "Kabir Mehta",      role: "Sales Executive", initials: "KM", target: 6000000 },
  { id: "u5", name: "Farah Qureshi",    role: "BDE",             initials: "FQ", target: 4000000 },
];
export const userById = (id: string) => USERS.find((u) => u.id === id)!;

export const SOURCES = ["Website", "IndiaMART", "Referral", "GeM Portal", "Cold Outreach", "Existing Client", "LinkedIn"] as const;
export const INDUSTRIES = ["Pharmaceuticals", "Logistics", "Education", "Manufacturing", "Healthcare", "BFSI", "Public Sector"] as const;

export interface Account {
  id: string; name: string; industry: string; ownerId: string;
  contacts: number; openOpps: number; potential: number; lifetime: number;
  lastInteraction: string; status: "Active" | "Prospect" | "Dormant";
}

export const ACCOUNTS: Account[] = [
  { id: "a1", name: "Meridian Pharma Labs Pvt Ltd", industry: "Pharmaceuticals", ownerId: "u2", contacts: 4, openOpps: 2, potential: 5100000, lifetime: 12400000, lastInteraction: "2026-09-26", status: "Active" },
  { id: "a2", name: "Northgate Logistics Ltd",      industry: "Logistics",       ownerId: "u3", contacts: 3, openOpps: 1, potential: 1850000, lifetime: 6300000,  lastInteraction: "2026-09-24", status: "Active" },
  { id: "a3", name: "Sunridge Education Trust",     industry: "Education",       ownerId: "u4", contacts: 2, openOpps: 1, potential: 940000,  lifetime: 1750000,  lastInteraction: "2026-09-12", status: "Active" },
  { id: "a4", name: "Kestrel Manufacturing Co",     industry: "Manufacturing",   ownerId: "u3", contacts: 5, openOpps: 2, potential: 3600000, lifetime: 8900000,  lastInteraction: "2026-09-25", status: "Active" },
  { id: "a5", name: "Alder Health Systems",         industry: "Healthcare",      ownerId: "u2", contacts: 3, openOpps: 1, potential: 2200000, lifetime: 4100000,  lastInteraction: "2026-08-30", status: "Dormant" },
  { id: "a6", name: "Vantage Capital Services",     industry: "BFSI",            ownerId: "u5", contacts: 2, openOpps: 1, potential: 1400000, lifetime: 0,        lastInteraction: "2026-09-27", status: "Prospect" },
  { id: "a7", name: "Harbour Civic Authority",      industry: "Public Sector",   ownerId: "u4", contacts: 4, openOpps: 1, potential: 2750000, lifetime: 3200000,  lastInteraction: "2026-09-19", status: "Active" },
  { id: "a8", name: "Peregrine Textiles Pvt Ltd",   industry: "Manufacturing",   ownerId: "u5", contacts: 1, openOpps: 0, potential: 620000,  lifetime: 1150000,  lastInteraction: "2026-07-14", status: "Dormant" },
];
export const accountById = (id: string) => ACCOUNTS.find((a) => a.id === id)!;

export interface Lead {
  id: string; name: string; company: string; accountId?: string; title: string;
  email: string; phone: string; source: string; ownerId: string;
  stage: Stage; score: number; priority: "High" | "Medium" | "Low";
  created: string; lastActivity: string; nextFollowUp: string; overdue?: boolean;
  value: number;
}

export const LEADS: Lead[] = [
  { id: "L-2041", name: "Devika Rao",     company: "Meridian Pharma Labs Pvt Ltd", accountId: "a1", title: "Head of IT",            email: "devika.rao@meridianpharma.example",   phone: "+91 98110 24501", source: "Existing Client", ownerId: "u2", stage: "negotiation", score: 92, priority: "High",   created: "2026-08-14", lastActivity: "2026-09-26", nextFollowUp: "2026-09-28", value: 4320000 },
  { id: "L-2040", name: "Imran Shaikh",   company: "Kestrel Manufacturing Co",     accountId: "a4", title: "Plant IT Manager",     email: "imran.shaikh@kestrelmfg.example",     phone: "+91 98204 71133", source: "IndiaMART",       ownerId: "u3", stage: "proposal",    score: 78, priority: "High",   created: "2026-08-29", lastActivity: "2026-09-25", nextFollowUp: "2026-09-29", value: 2100000 },
  { id: "L-2039", name: "Sneha Kulkarni", company: "Northgate Logistics Ltd",      accountId: "a2", title: "Procurement Lead",     email: "sneha.k@northgatelogistics.example",  phone: "+91 99870 41220", source: "Referral",        ownerId: "u3", stage: "requirement", score: 71, priority: "Medium", created: "2026-09-02", lastActivity: "2026-09-24", nextFollowUp: "2026-09-27", overdue: true, value: 1850000 },
  { id: "L-2038", name: "Arjun Bhatt",    company: "Harbour Civic Authority",      accountId: "a7", title: "Deputy Engineer (IT)", email: "arjun.bhatt@harbourcivic.example",    phone: "+91 90045 88210", source: "GeM Portal",      ownerId: "u4", stage: "contacted",   score: 64, priority: "Medium", created: "2026-09-08", lastActivity: "2026-09-19", nextFollowUp: "2026-09-26", overdue: true, value: 2750000 },
  { id: "L-2037", name: "Nisha Verma",    company: "Vantage Capital Services",     accountId: "a6", title: "Operations Director",  email: "nisha.verma@vantagecap.example",      phone: "+91 91234 55098", source: "LinkedIn",        ownerId: "u5", stage: "qualified",   score: 58, priority: "Medium", created: "2026-09-18", lastActivity: "2026-09-27", nextFollowUp: "2026-09-30", value: 1400000 },
  { id: "L-2036", name: "Tanmay Ghosh",   company: "Sunridge Education Trust",     accountId: "a3", title: "Administrator",        email: "tanmay.ghosh@sunridgetrust.example",  phone: "+91 98300 17742", source: "Website",         ownerId: "u4", stage: "proposal",    score: 69, priority: "Medium", created: "2026-08-21", lastActivity: "2026-09-12", nextFollowUp: "2026-09-25", overdue: true, value: 940000 },
  { id: "L-2035", name: "Rhea Menon",     company: "Alder Health Systems",         accountId: "a5", title: "CIO",                  email: "rhea.menon@alderhealth.example",      phone: "+91 97400 30281", source: "Referral",        ownerId: "u2", stage: "new",         score: 44, priority: "Low",    created: "2026-09-25", lastActivity: "2026-09-25", nextFollowUp: "2026-09-29", value: 2200000 },
  { id: "L-2034", name: "Vikram Anand",   company: "Peregrine Textiles Pvt Ltd",   accountId: "a8", title: "GM Operations",        email: "vikram.anand@peregrinetex.example",   phone: "+91 90876 22140", source: "Cold Outreach",   ownerId: "u5", stage: "lost",        score: 31, priority: "Low",    created: "2026-06-30", lastActivity: "2026-07-14", nextFollowUp: "—", value: 620000 },
  { id: "L-2033", name: "Aisha Kapoor",   company: "Meridian Pharma Labs Pvt Ltd", accountId: "a1", title: "Finance Controller",   email: "aisha.kapoor@meridianpharma.example", phone: "+91 98110 24502", source: "Existing Client", ownerId: "u2", stage: "won",         score: 88, priority: "High",   created: "2026-05-11", lastActivity: "2026-09-01", nextFollowUp: "—", value: 780000 },
  { id: "L-2032", name: "Gaurav Sethi",   company: "Kestrel Manufacturing Co",     accountId: "a4", title: "Head of Procurement",  email: "gaurav.sethi@kestrelmfg.example",     phone: "+91 98204 71134", source: "IndiaMART",       ownerId: "u3", stage: "new",         score: 52, priority: "Low",    created: "2026-09-27", lastActivity: "2026-09-27", nextFollowUp: "2026-09-30", value: 1500000 },
];

export interface Opportunity {
  id: string; name: string; accountId: string; ownerId: string; stage: Stage;
  value: number; close: string; nextAction: string;
  products: { name: string; qty: number; unit: number }[];
}

export const OPPORTUNITIES: Opportunity[] = [
  { id: "O-8801", name: "Microsoft 365 E3 renewal — 240 seats", accountId: "a1", ownerId: "u2", stage: "negotiation", value: 4320000, close: "2026-10-15", nextAction: "Send revised pricing with 3-year commit", products: [{ name: "Microsoft 365 E3 (annual)", qty: 240, unit: 16800 }, { name: "Deployment & migration", qty: 1, unit: 288000 }] },
  { id: "O-8802", name: "Plant-wide endpoint refresh",          accountId: "a4", ownerId: "u3", stage: "proposal",    value: 2100000, close: "2026-11-05", nextAction: "Follow up on proposal sent 25 Sept",    products: [{ name: "Business laptops", qty: 60, unit: 31500 }, { name: "Endpoint security (3yr)", qty: 60, unit: 3500 }] },
  { id: "O-8803", name: "Fleet telematics licences",            accountId: "a2", ownerId: "u3", stage: "requirement", value: 1850000, close: "2026-11-20", nextAction: "Site survey with operations team",      products: [{ name: "Telematics subscription", qty: 185, unit: 10000 }] },
  { id: "O-8804", name: "Campus Wi-Fi upgrade",                 accountId: "a3", ownerId: "u4", stage: "proposal",    value: 940000,  close: "2026-10-28", nextAction: "Chase purchase committee decision",     products: [{ name: "Access points", qty: 40, unit: 18500 }, { name: "Controller & install", qty: 1, unit: 200000 }] },
  { id: "O-8805", name: "e-Governance workstation tender",      accountId: "a7", ownerId: "u4", stage: "contacted",   value: 2750000, close: "2026-12-10", nextAction: "Prepare GeM bid documentation",         products: [{ name: "Desktop workstations", qty: 110, unit: 25000 }] },
  { id: "O-8806", name: "Core banking endpoint security",       accountId: "a6", ownerId: "u5", stage: "qualified",   value: 1400000, close: "2026-12-01", nextAction: "Discovery call with CISO",              products: [{ name: "Endpoint protection (annual)", qty: 400, unit: 3500 }] },
  { id: "O-8807", name: "Adobe CC team licences",               accountId: "a5", ownerId: "u2", stage: "new",         value: 2200000, close: "2026-12-20", nextAction: "Qualify budget and timeline",           products: [{ name: "Adobe CC for teams", qty: 55, unit: 40000 }] },
  { id: "O-8808", name: "Autodesk AutoCAD LT — 12 seats",       accountId: "a4", ownerId: "u3", stage: "negotiation", value: 780000,  close: "2026-10-22", nextAction: "Confirm multi-year discount",           products: [{ name: "AutoCAD LT (annual)", qty: 12, unit: 65000 }] },
  { id: "O-8809", name: "Server hardware refresh",              accountId: "a1", ownerId: "u2", stage: "won",         value: 1150000, close: "2026-09-18", nextAction: "—",                                     products: [{ name: "Rack servers", qty: 2, unit: 575000 }] },
  { id: "O-8810", name: "Warehouse barcode rollout",            accountId: "a2", ownerId: "u3", stage: "lost",        value: 660000,  close: "2026-09-05", nextAction: "Re-engage Feb 2027",                    products: [{ name: "Barcode scanners", qty: 22, unit: 30000 }] },
];

export interface Task {
  id: string; title: string; type: "Call" | "Meeting" | "Email" | "To-do";
  related: string; ownerId: string; due: string; priority: "High" | "Medium" | "Low";
  state: "overdue" | "today" | "upcoming" | "done"; auto?: boolean;
}

export const TASKS: Task[] = [
  { id: "T-01", title: "Chase proposal decision",            type: "Call",    related: "Sunridge Education Trust",     ownerId: "u4", due: "2026-09-25", priority: "High",   state: "overdue", auto: true },
  { id: "T-02", title: "Site survey follow-up",              type: "Call",    related: "Northgate Logistics Ltd",      ownerId: "u3", due: "2026-09-27", priority: "Medium", state: "overdue", auto: true },
  { id: "T-03", title: "Prepare GeM bid documents",          type: "To-do",   related: "Harbour Civic Authority",      ownerId: "u4", due: "2026-09-26", priority: "High",   state: "overdue" },
  { id: "T-04", title: "Send revised pricing (3-year)",      type: "Email",   related: "Meridian Pharma Labs Pvt Ltd", ownerId: "u2", due: "2026-09-28", priority: "High",   state: "today",   auto: true },
  { id: "T-05", title: "Discovery call with CISO",           type: "Call",    related: "Vantage Capital Services",     ownerId: "u5", due: "2026-09-28", priority: "Medium", state: "today" },
  { id: "T-06", title: "Confirm multi-year discount",        type: "Call",    related: "Kestrel Manufacturing Co",     ownerId: "u3", due: "2026-09-28", priority: "High",   state: "today",   auto: true },
  { id: "T-07", title: "Quarterly review meeting",           type: "Meeting", related: "Meridian Pharma Labs Pvt Ltd", ownerId: "u2", due: "2026-09-29", priority: "Medium", state: "upcoming" },
  { id: "T-08", title: "Qualify budget and timeline",        type: "Call",    related: "Alder Health Systems",         ownerId: "u2", due: "2026-09-29", priority: "Low",    state: "upcoming", auto: true },
  { id: "T-09", title: "Proposal walkthrough",               type: "Meeting", related: "Kestrel Manufacturing Co",     ownerId: "u3", due: "2026-09-30", priority: "High",   state: "upcoming" },
  { id: "T-10", title: "Re-engagement check",                type: "Call",    related: "Peregrine Textiles Pvt Ltd",   ownerId: "u5", due: "2026-10-02", priority: "Low",    state: "upcoming", auto: true },
];

export interface TimelineItem {
  id: string; ts: string; kind: "call" | "meeting" | "email" | "note" | "doc" | "stage" | "auto";
  title: string; body?: string; by: string; tone?: "neutral" | "accent" | "good" | "warn" | "bad";
}

export const LEAD_TIMELINE: TimelineItem[] = [
  { id: "e1", ts: "2026-09-26 16:40", kind: "auto",    title: "Automation — next follow-up created", body: "Rule “Negotiation needs a weekly touch” created a call task due 28 Sept for Priyanshi Sharma.", by: "System", tone: "accent" },
  { id: "e2", ts: "2026-09-26 16:35", kind: "call",    title: "Call — 12 min",                       body: "Devika confirmed budget approved. Wants a 3-year commit quoted alongside annual.", by: "Priyanshi Sharma", tone: "good" },
  { id: "e3", ts: "2026-09-25 11:05", kind: "doc",     title: "Quotation TZ/QT/2026-27/0047 sent",   body: "₹43,20,000 · Sent to devika.rao@meridianpharma.example", by: "Priyanshi Sharma", tone: "accent" },
  { id: "e4", ts: "2026-09-24 09:20", kind: "stage",   title: "Stage changed — Proposal Sent → Negotiation", by: "Priyanshi Sharma", tone: "warn" },
  { id: "e5", ts: "2026-09-22 15:10", kind: "meeting", title: "Meeting — on-site, Modi Nagar",       body: "Walked licence count. 240 seats, up from 210. IT and finance both present.", by: "Priyanshi Sharma", tone: "good" },
  { id: "e6", ts: "2026-09-19 10:02", kind: "email",   title: "Email — E3 vs Business Premium",      body: "Comparison sheet sent. Opened twice.", by: "Priyanshi Sharma", tone: "neutral" },
  { id: "e7", ts: "2026-09-15 14:30", kind: "auto",    title: "Automation — lead score raised to 92", body: "Engagement in last 14 days: 2 calls, 1 meeting, 3 emails opened.", by: "System", tone: "accent" },
  { id: "e8", ts: "2026-08-14 09:00", kind: "auto",    title: "Automation — lead assigned",          body: "Source “Existing Client” → routed to account owner Priyanshi Sharma. First follow-up task created.", by: "System", tone: "accent" },
];

/* ── figures for the dashboards ─────────────────────────────────────── */
export const REVENUE_TREND = [
  { month: "Apr", won: 3100000, target: 4000000 },
  { month: "May", won: 4600000, target: 4000000 },
  { month: "Jun", won: 3800000, target: 4200000 },
  { month: "Jul", won: 5200000, target: 4200000 },
  { month: "Aug", won: 4100000, target: 4500000 },
  { month: "Sep", won: 5850000, target: 4500000 },
];

export const FUNNEL = [
  { stage: "Lead",                   count: 148 },
  { stage: "Qualified",              count: 96 },
  { stage: "Contacted",              count: 71 },
  { stage: "Requirement Identified", count: 44 },
  { stage: "Proposal Sent",          count: 27 },
  { stage: "Negotiation",            count: 15 },
  { stage: "Won",                    count: 9 },
];

export const SOURCE_PERF = [
  { source: "IndiaMART",       leads: 52, won: 8,  revenue: 4200000 },
  { source: "Referral",        leads: 28, won: 9,  revenue: 5600000 },
  { source: "Website",         leads: 34, won: 5,  revenue: 2100000 },
  { source: "GeM Portal",      leads: 14, won: 3,  revenue: 3800000 },
  { source: "Cold Outreach",   leads: 20, won: 1,  revenue: 480000 },
];

export const LOST_REASONS = [
  { reason: "Price",                 count: 11 },
  { reason: "Competitor",            count: 8 },
  { reason: "Budget issue",          count: 6 },
  { reason: "Timing",                count: 4 },
  { reason: "Stopped responding",    count: 3 },
];

export const TEAM_PERF = USERS.filter((u) => u.id !== "u1").map((u, i) => ({
  ...u,
  leads: [42, 31, 27, 19][i] ?? 0,
  calls: [88, 74, 61, 44][i] ?? 0,
  meetings: [14, 11, 9, 5][i] ?? 0,
  opps: [9, 7, 6, 4][i] ?? 0,
  won: [5, 3, 3, 1][i] ?? 0,
  revenue: [7350000, 4180000, 3920000, 1240000][i] ?? 0,
  pending: [3, 5, 2, 4][i] ?? 0,
}));

export const inr = (n: number): string =>
  "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n));

export const inrShort = (n: number): string => {
  if (Math.abs(n) >= 10000000) return "₹" + (n / 10000000).toFixed(2) + " Cr";
  if (Math.abs(n) >= 100000) return "₹" + (n / 100000).toFixed(2) + " L";
  return inr(n);
};

export const fmtDay = (iso: string): string => {
  if (!iso || iso === "—") return "—";
  const d = new Date(iso.slice(0, 10) + "T12:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};
