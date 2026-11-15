/** Types for the server's copy of the automatic-message line, so the test
 *  that holds it against src/domain/integrations/automated.ts can import
 *  both — see quoteExtract.d.mts for why these files exist. */
export declare const AUTOMATED_NOTICE: Record<string, string>;
export declare function automatedNotice(kind: string, company?: string): string;
