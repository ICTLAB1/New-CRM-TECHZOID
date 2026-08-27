/**
 * Reading a GSTIN verification back from the government's register.
 *
 * WHAT THIS ADDS OVER validateGSTIN. The checksum validator in
 * src/domain/gstin/validate.ts answers "is this a well-formed GSTIN" — it
 * reads the state code and the PAN out of the number itself and can do that
 * offline. It cannot tell you whether the number belongs to anybody, whether
 * that registration is still active, or what name it is registered under.
 * A cancelled GSTIN passes the checksum perfectly, and an invoice raised
 * against one is an invoice the customer's accountant will send back.
 *
 * WHY THE PARSING IS FORGIVING. The register's own field names are the
 * abbreviations GSTN has used for years — `lgnm`, `tradeNam`, `sts`, `rgdt`
 * — and providers pass some through untouched while renaming others to
 * snake_case, and nest the payload one or two levels deep depending on the
 * endpoint. Rather than pin this to one spelling and have the whole feature
 * return blanks when it is wrong, each field is looked up under every
 * spelling it is known by. A field that genuinely is not there reads as an
 * empty string, which the UI shows as "not stated" rather than as a lie.
 */

export interface GstinAddress {
  line: string;
  city: string;
  state: string;
  pincode: string;
}

export interface GstinVerification {
  gstin: string;
  /** The name the business is registered under. This is what belongs on a
   *  tax invoice — the trade name is what people call them. */
  legalName: string;
  tradeName: string;
  /** "Active", "Cancelled", "Suspended", … straight from the register. */
  status: string;
  /** "Regular", "Composition", "Casual Taxable Person", … */
  taxpayerType: string;
  constitution: string;
  /** ISO yyyy-mm-dd. The register writes dates dd/mm/yyyy. */
  registeredOn: string;
  cancelledOn: string;
  address: GstinAddress;
  natureOfBusiness: string[];
}

/** Every spelling a field is known by, most specific first. */
const FIELDS = {
  gstin: ["gstin", "gstin_number", "gstinNumber", "gstIn"],
  legalName: ["lgnm", "legal_name", "legalName", "legal_name_of_business", "name"],
  tradeName: ["tradeNam", "tradenam", "trade_name", "tradeName"],
  status: ["sts", "status", "gstin_status", "registration_status"],
  taxpayerType: ["dty", "taxpayer_type", "taxpayerType", "dealer_type"],
  constitution: ["ctb", "constitution_of_business", "constitutionOfBusiness", "business_constitution"],
  registeredOn: ["rgdt", "registration_date", "registrationDate", "date_of_registration"],
  cancelledOn: ["cxdt", "cancellation_date", "cancellationDate", "date_of_cancellation"],
  natureOfBusiness: ["nba", "nature_of_business_activities", "natureOfBusiness", "nature_of_business"],
} as const;

type Bag = Record<string, unknown>;

const isBag = (v: unknown): v is Bag => !!v && typeof v === "object" && !Array.isArray(v);

/** The first of `names` that carries something, as a trimmed string. */
function pick(bag: Bag, names: readonly string[]): string {
  for (const name of names) {
    const value = bag[name];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function pickList(bag: Bag, names: readonly string[]): string[] {
  for (const name of names) {
    const value = bag[name];
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
    if (typeof value === "string" && value.trim()) return [value.trim()];
  }
  return [];
}

/**
 * The object actually holding the registration.
 *
 * Providers wrap it differently — `{data: {...}}`, `{data: {data: {...}}}`,
 * or the fields at the top. Rather than guess, walk down while there is a
 * single obvious wrapper and stop at the first object that names a GSTIN or
 * a legal name.
 */
function unwrap(payload: unknown, depth = 0): Bag | null {
  if (!isBag(payload) || depth > 4) return null;
  const looksLikeIt = FIELDS.gstin.some((k) => payload[k]) || FIELDS.legalName.some((k) => payload[k]);
  if (looksLikeIt) return payload;
  for (const key of ["data", "result", "response", "payload"]) {
    const inner = unwrap(payload[key], depth + 1);
    if (inner) return inner;
  }
  return null;
}

/** dd/mm/yyyy — the register's format — to ISO. Anything already ISO, or
 *  anything unrecognisable, is passed through untouched. */
export function registerDate(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return value;
  const [, d, mo, y] = m;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function readAddress(bag: Bag): GstinAddress {
  /* The principal place of business. `pradr` holds an `addr` object and a
     `ntr` (nature of the premises) beside it; some providers flatten the
     two together, so look in both. */
  const pradr = ["pradr", "principal_address", "principalAddress", "address"]
    .map((k) => bag[k]).find(isBag) as Bag | undefined;
  const addr = (pradr && (["addr", "address"].map((k) => pradr[k]).find(isBag) as Bag | undefined)) || pradr || {};

  const line = ["bno", "building_number", "flno", "floor_number", "bnm", "building_name",
                "st", "street", "loc", "location", "landMark", "landmark"]
    .map((k) => (typeof addr[k] === "string" ? (addr[k] as string).trim() : ""))
    .filter(Boolean)
    /* The register repeats itself — a locality often appears as both `loc`
       and part of `st`. Duplicated fragments read as a typo in an address
       printed on an invoice. */
    .filter((part, i, all) => all.findIndex((p) => p.toLowerCase() === part.toLowerCase()) === i)
    .join(", ");

  return {
    line,
    city: pick(addr, ["city", "dst", "district", "loc"]),
    state: pick(addr, ["stcd", "state", "state_name", "stateName"]),
    pincode: pick(addr, ["pncd", "pincode", "pin_code", "postal_code"]),
  };
}

/**
 * @returns the registration, or null when the payload holds no recognisable
 * one — a provider error body, an empty result, anything unexpected. Null
 * means "we did not learn anything", which the caller reports as such
 * rather than as a failed verification: those are different, and telling a
 * salesperson a good GSTIN is bad is the more expensive mistake.
 */
export function parseGstinResponse(payload: unknown): GstinVerification | null {
  const bag = unwrap(payload);
  if (!bag) return null;
  const gstin = pick(bag, FIELDS.gstin).toUpperCase();
  const legalName = pick(bag, FIELDS.legalName);
  if (!gstin && !legalName) return null;
  return {
    gstin,
    legalName,
    tradeName: pick(bag, FIELDS.tradeName),
    status: pick(bag, FIELDS.status),
    taxpayerType: pick(bag, FIELDS.taxpayerType),
    constitution: pick(bag, FIELDS.constitution),
    registeredOn: registerDate(pick(bag, FIELDS.registeredOn)),
    cancelledOn: registerDate(pick(bag, FIELDS.cancelledOn)),
    address: readAddress(bag),
    natureOfBusiness: pickList(bag, FIELDS.natureOfBusiness),
  };
}

/** Whether this registration can be invoiced against today. */
export function isActiveRegistration(v: Pick<GstinVerification, "status">): boolean {
  return /^act/i.test(v.status.trim());
}

/**
 * How the status should read to a salesperson.
 *
 * A blank status is NOT reported as active. The register answered without
 * saying, and guessing in the reassuring direction is how a cancelled
 * registration gets invoiced.
 */
export function statusLine(v: GstinVerification): { tone: "good" | "warn" | "bad"; text: string } {
  const status = v.status.trim();
  if (!status) return { tone: "warn", text: "The register did not state a status for this GSTIN." };
  if (isActiveRegistration(v)) return { tone: "good", text: `Active${v.taxpayerType ? " · " + v.taxpayerType : ""}` };
  if (/cancel/i.test(status)) {
    return { tone: "bad", text: `Cancelled${v.cancelledOn ? " on " + v.cancelledOn : ""} — invoicing this number will be rejected.` };
  }
  return { tone: "warn", text: status };
}

/** Punctuation, case and legal-form noise removed, for comparing two names
 *  that are the same company written differently. */
const flatten = (name: string): string =>
  String(name ?? "").toUpperCase()
    .replace(/\b(PVT|PRIVATE|LTD|LIMITED|LLP|INC|CO|COMPANY|AND|THE)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/**
 * Whether the name typed into the CRM disagrees with the register.
 *
 * Deliberately forgiving: "Acme Manufacturing India Pvt Ltd" and "ACME
 * MANUFACTURING INDIA PRIVATE LIMITED" are the same company, and flagging
 * that pair as a mismatch every time is how people learn to ignore the
 * flag. It reports only a real difference, and it never blocks a save —
 * plenty of customers are known internally by a name that is not the one
 * on their registration.
 */
export function nameDisagrees(typed: string, v: GstinVerification): boolean {
  const a = flatten(typed);
  if (!a) return false;
  return [v.legalName, v.tradeName].filter(Boolean).map(flatten).every((b) => !!b && b !== a && !b.includes(a) && !a.includes(b));
}
