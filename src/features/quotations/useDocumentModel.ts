import { useMemo } from "react";
import { buildDocumentModel } from "../../domain/documents/model";
import { normalizeDocTemplate, type DocTemplate } from "../../domain/documents/template";
import { computeDocument } from "../../domain/tax/compute";
import type { SalesDocument } from "../../domain/documents/create";

/**
 * Totals and the document model for one document.
 *
 * Every screen that shows money for a document goes through here. Nothing
 * re-derives a total of its own — that is how an exempt quotation ends up
 * charging 18% on one screen and nothing on another.
 */
export function useDocumentModel(
  doc: SalesDocument,
  settings: Record<string, unknown>,
  docType: "quotation" | "proforma",
) {
  return useMemo(() => {
    const sellerState = ((settings["company"] as { state?: string } | undefined)?.state) ?? "Delhi";
    const totals = computeDocument(doc, sellerState);
    const template: DocTemplate = normalizeDocTemplate(settings["docTemplate"] as Partial<DocTemplate>);
    const accounts = (settings["bankAccounts"] as { id?: string }[] | undefined) ?? [];
    const bankAccount =
      accounts.find((a) => a.id === doc.bankAccountId) ?? accounts[0] ?? (settings["bank"] as object) ?? {};
    const model = buildDocumentModel({ doc, settings, totals, docType, template, bankAccount });
    return { totals, model };
  }, [doc, settings, docType]);
}
