/** Types for the customer tool schema — see quoteExtract.d.mts for why. */
export declare const MAX_TEXT: number;
export declare const CUSTOMER_TOOL: {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[] };
};
export declare function systemPrompt(): string;
