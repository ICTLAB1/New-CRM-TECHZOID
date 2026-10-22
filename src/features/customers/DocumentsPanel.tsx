import { moneyList } from "../../domain/currency/format";
import { fmtDate } from "../../domain/dates";
import type { documentsForCustomer } from "../../domain/customers/documents";

type Row = ReturnType<typeof documentsForCustomer>[number];

const TONE: Record<string, string> = {
  Accepted: "good", Paid: "good", Issued: "good",
  Sent: "accent", Draft: "neutral", Cancelled: "neutral",
  Expired: "bad", Rejected: "bad",
};

/**
 * Everything this customer has been sent, on the customer.
 *
 * Quotations, proformas and invoices are three tables because they are three
 * different things, and three screens because of it. Answering "what have we
 * sent this company, and what came of it" meant opening each one and
 * filtering it by name — which is a question asked constantly and a layout
 * that answered it nowhere.
 *
 * Amounts are worked out from the lines on each document, not read from a
 * figure stored on the row, so this cannot drift from the document itself.
 */
export function DocumentsPanel({ documents }: { documents: Row[] }) {
  if (documents.length === 0) {
    return (
      <div className="stack">
        <div className="pt-section-title">Quotations, proformas and invoices</div>
        <p className="muted" style={{ margin: 0 }}>Nothing has been raised for this customer yet.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="pt-section-title">
        Quotations, proformas and invoices
        <span className="muted"> · {documents.length}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Number</th>
              <th>What</th>
              <th>Date</th>
              <th>Status</th>
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={`${d.source}:${d.id}`}>
                <td data-label="Number" className="mono">{d.number}</td>
                <td data-label="What">{d.kind}</td>
                <td data-label="Date">{fmtDate(d.date)}</td>
                <td data-label="Status">
                  <span className={`chip ${TONE[d.status ?? ""] ?? "neutral"}`}>{d.status}</span>
                </td>
                {/* Never summed. A customer quoted in rupees and dollars has
                    two totals, and one number across both is meaningless. */}
                <td data-label="Value" className="num strong">{moneyList(d.amount, d.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
