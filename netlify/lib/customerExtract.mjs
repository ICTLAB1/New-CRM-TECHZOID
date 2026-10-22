/**
 * Reading a customer out of a sentence.
 *
 * Same contract as the quote reader: the schema names every field the model
 * may return, and anything else is dropped by the API before it reaches us.
 *
 * NOTHING DERIVED IS ASKED FOR. The state and the PAN are both inside a
 * GSTIN — first two digits, characters three to twelve — so they are read
 * off it in src/domain/customers/fromText.ts rather than requested here. A
 * model asked for a state alongside a GSTIN will sometimes supply one that
 * disagrees with it, and a customer whose state contradicts their GSTIN is
 * charged the wrong half of GST on every invoice they are ever sent.
 */

export const MAX_TEXT = 2_000;

export const CUSTOMER_TOOL = {
  name: "record_customer",
  description: "Record a new customer's details exactly as the salesperson gave them.",
  input_schema: {
    type: "object",
    properties: {
      is_customer: {
        type: "boolean",
        description: "False if this is not somebody describing a customer to add.",
      },
      company: { type: "string", description: "The company name." },
      contact: { type: "string", description: "The person's name." },
      designation: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      altPhone: { type: "string" },
      website: { type: "string" },
      gstin: {
        type: "string",
        description: "Only if written out in full. Never construct or guess one.",
      },
      pan: { type: "string", description: "Only if written out. Never guess." },
      address: { type: "string", description: "Street address only, without city or state." },
      city: { type: "string" },
      state: {
        type: "string",
        description:
          "Indian state, ONLY when no GSTIN was given. With a GSTIN the state is read from it.",
      },
      country: { type: "string", description: "Only if stated. Assume nothing." },
      pincode: { type: "string" },
      segment: {
        type: "string",
        enum: ["SMB", "Enterprise", "Government", "Education", "Startup"],
        description: "Only if it is clear from what was said.",
      },
      source: {
        type: "string",
        description: "How they came to us, only if stated — a referral, a call, an email.",
      },
      notes: { type: "string", description: "Anything else said that is worth keeping." },
    },
    required: ["is_customer"],
  },
};

export function systemPrompt() {
  return [
    "You turn an Indian IT reseller's shorthand into the fields of a customer record.",
    "",
    "RECORD WHAT WAS SAID, NOTHING ELSE. A field nobody mentioned must be left",
    "out. Leaving it out is correct and harmless — it is filled from the",
    "workspace defaults afterwards. Guessing it puts wrong details on every",
    "document this customer is ever sent.",
    "",
    "NEVER CONSTRUCT A GSTIN OR A PAN. They are checksummed identifiers that",
    "belong to a real registration. Include one only if it was written out in",
    "full, exactly as written.",
    "",
    "DO NOT SUPPLY A STATE IF A GSTIN WAS GIVEN. The state lives in the first",
    "two digits of the GSTIN and is read from there. A state that disagrees with",
    "the GSTIN decides the wrong half of GST on every invoice.",
    "",
    "Split the address: street lines in 'address', the city in 'city', the",
    "six-digit PIN in 'pincode'. Do not repeat the city inside the address.",
    "",
    "Set is_customer false if the person is asking for something else.",
  ].join("\n");
}
