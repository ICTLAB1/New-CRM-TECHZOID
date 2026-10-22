/**
 * Types for the quote tool schema, which is plain JavaScript because the
 * server imports it too. Declared here so the browser-side contract test can
 * read the schema and check that every field it declares actually reaches a
 * quotation — see src/domain/quotes/contract.test.ts.
 */
export declare const MAX_TEXT: number;

export declare const QUOTE_TOOL: {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
};

export declare function systemPrompt(): string;
