import { useMemo } from "react";
import { buildDocumentModel, type DocType } from "../../domain/documents/model";
import { normalizeDocTemplate, type DocTemplate } from "../../domain/documents/template";
import { computeDocument } from "../../domain/tax/compute";
import type { SalesDocument } from "../../domain/documents/create";
import { pickBankAccount, readAccounts } from "../../domain/banking/accounts";

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
  docType: DocType,
) {
  return useMemo(() => {
    const sellerState = ((settings["company"] as { state?: string } | undefined)?.state) ?? "Delhi";
    /* CGST+SGST versus IGST is decided by comparing the counterparty's state
       against ours — and on a purchase order the counterparty is the
       SUPPLIER, not the bill-to party (which is us). Passing the vendor's
       state here is what makes an out-of-state distributor charge IGST. */
    const forTax = docType === "purchase_order" ? { ...doc, billState: doc.vendorState ?? "" } : doc;
    const totals = computeDocument(forTax, sellerState);
    const template: DocTemplate = normalizeDocTemplate(settings["docTemplate"] as Partial<DocTemplate>);
    /* The account this document names, else one matching its currency, else
       the default — see src/domain/banking/accounts.ts. `settings.bank` is
       the pre-list arrangement and is still honoured for a workspace that
       has never opened the new panel. */
    const accounts = readAccounts(settings);
    const bankAccount =
      pickBankAccount(accounts, doc.bankAccountId, doc.currency) ?? (settings["bank"] as object) ?? {};
    const model = buildDocumentModel({ doc, settings, totals, docType, template, bankAccount });
    return { totals, model };
  }, [doc, settings, docType]);
}
