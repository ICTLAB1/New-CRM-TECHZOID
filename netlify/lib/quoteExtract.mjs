/**
 * Reading a quotation out of a sentence.
 *
 * The tool schema IS the contract. Everything the model may return is named
 * here with a type; anything it tries to add is dropped by the API before it
 * reaches us. That is the whole defence against a model that decides to be
 * helpful and supply an HSN code or a customer id it has reasoned its way to
 * — those are looked up locally, in src/domain/quotes/fromText.ts, against
 * the catalog and the customer list.
 */

export const MAX_TEXT = 4_000;

export const QUOTE_TOOL = {
  name: "record_quote_request",
  description:
    "Record what the salesperson asked for: who the quotation is for and what is on it.",
  input_schema: {
    type: "object",
    properties: {
      is_quote_request: {
        type: "boolean",
        description: "False if this is not a request to raise a quotation at all.",
      },
      customer: {
        type: "object",
        description: "The company being quoted, exactly as named. Never invent details.",
        properties: {
          company: { type: "string" },
          contact: { type: "string", description: "The person's name, if one is given." },
          email: { type: "string" },
          phone: { type: "string" },
          gstin: { type: "string", description: "Only if written out. Never guess one." },
          state: { type: "string", description: "Indian state, only if stated." },
        },
      },
      items: {
        type: "array",
        description: "One entry per line. Keep the order they were said in.",
        items: {
          type: "object",
          properties: {
            desc: { type: "string", description: "The product as named, verbatim." },
            qty: { type: "number" },
            rate: { type: "number", description: "Price PER UNIT, not the line total. Omit if no price was stated." },
            unit: { type: "string" },
            discPercent: { type: "number", description: "Discount percent, only if stated." },
            taxPercent: { type: "number", description: "GST percent, only if stated." },
          },
          required: ["desc"],
        },
      },
      currency: { type: "string", description: "ISO code, only if stated (INR, USD, AED)." },
      validityDays: { type: "number", description: "Only if stated." },
      notes: { type: "string", description: "Anything said that belongs on the quotation as a note." },
    },
    required: ["is_quote_request"],
  },
};

export function systemPrompt() {
  return [
    "You turn an Indian IT reseller's shorthand into the fields of a quotation.",
    "",
    "RECORD WHAT WAS SAID, NOTHING ELSE. If a price, a quantity, a tax rate or a",
    "GSTIN was not stated, leave it out. A field you leave out is filled from the",
    "product catalog or the workspace's defaults, which are right; a field you",
    "guess at is wrong and goes on a document a customer will hold us to.",
    "",
    "RATE IS PER UNIT. '10 licences for 12,000' means a line total of 12,000, so",
    "the rate is 1200. '10 licences at 1,200' means the rate is 1200. If which one",
    "is meant is genuinely unclear, omit the rate rather than halve the deal.",
    "",
    "Indian digit grouping is normal: 1,18,000 is one hundred and eighteen",
    "thousand. 'lakh' is 100,000 and 'crore' is 10,000,000.",
    "",
    "Product names are written as said. Do not expand, correct or tidy them —",
    "they are matched against a catalog afterwards, and a name you improved is a",
    "name that no longer matches.",
    "",
    "Set is_quote_request false if the person is asking something else entirely.",
  ].join("\n");
}
