import { useState } from "react";
import { Button, Card, Textarea } from "../../components/primitives";
import { draftFromText, type DraftReport } from "../../domain/quotes/fromText";
import { customerFromText } from "../../domain/customers/fromText";
import { applyCustomer } from "../../domain/documents/create";
import { checkDuplicate } from "../../data/duplicateCheck";
import { nextCustomerCode } from "../../data/customerCode";
import { readQuoteRequest } from "../../data/quoteFromText";
import type { DocSettings, SalesDocument } from "../../domain/documents/create";
import type { Customer } from "../../domain/customers/customer";
import type { CatalogProduct } from "../../domain/catalog/types";

/**
 * Say what you want quoted, in words.
 *
 * IT OPENS A DRAFT; IT DOES NOT SEND ONE. The quotation lands in the ordinary
 * editor with the ordinary Save button, and the summary under the box says
 * what was understood before anybody looks at the document itself — which
 * customer it matched, which lines came from the catalog, and which line has
 * no price. A quantity or a rate misread out of a sentence becomes a price
 * the customer holds us to the moment it is sent, and there is no recalling
 * it. The typing was the slow part; the reading over was never the slow part.
 */
export function QuoteComposer({ settings, currentUser, customers, catalog, onDraft, onCreateCustomer }: {
  settings: Record<string, unknown>;
  currentUser: { id: string; name: string };
  customers: readonly Customer[];
  catalog: readonly CatalogProduct[];
  onDraft: (doc: SalesDocument) => void;
  /** Absent for anyone who may not add customers — then a new company is
   *  filled onto the quotation but no record is created. */
  onCreateCustomer?: (customer: Customer) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<DraftReport | null>(null);
  const [created, setCreated] = useState("");
  const [duplicate, setDuplicate] = useState("");

  const run = async () => {
    const said = text.trim();
    if (!said || busy) return;
    setBusy(true); setError(""); setReport(null); setCreated(""); setDuplicate("");
    const { fields, error: failed } = await readQuoteRequest(said);
    setBusy(false);
    if (failed || !fields) { setError(failed || "That could not be read."); return; }

    const { doc, report: read } = draftFromText(fields, {
      settings: settings as DocSettings & Record<string, unknown>,
      user: currentUser,
      customers,
      catalog,
    });
    setReport(read);

    /* A COMPANY NOBODY HAS ON FILE IS FILED, which is what was asked for —
       but never before asking the database whether it is already there. The
       list this screen holds is only what RLS lets this person see, so a
       customer owned by a colleague is invisible here and would be created a
       second time: two records, two sets of quotations, and a payment
       history split down the middle. checkDuplicate asks the server, which
       can see all of them. */
    if (read.unmatchedCustomerName && onCreateCustomer) {
      const details = fields.customer ?? {};
      try {
        const hit = await checkDuplicate({
          company: read.unmatchedCustomerName,
          phone: details.phone,
          gstin: details.gstin,
        });
        if (hit) {
          setDuplicate(
            `${hit.company} is already a customer (${hit.ownerName}). No new record was created — ` +
            "pick them in the draft, or ask whoever owns the record.",
          );
          onDraft(doc);
          return;
        }
      } catch {
        /* The check could not run. Filling the details and letting a person
           decide beats filing a record on an answer nobody got. */
        setDuplicate("Could not check whether this company is already on file, so no record was created.");
        onDraft(doc);
        return;
      }

      const customer = customerFromText(
        details,
        currentUser.id,
        Math.random().toString(36).slice(2, 14),
      );
      /* The code prints on every document raised for them, so it is
         allocated now rather than left for whenever somebody opens the
         record — this customer is about to appear on a quotation. */
      try {
        customer.code = await nextCustomerCode(
          customers.length + 1,
          String(settings["customerPrefix"] ?? "CUST-"),
        );
      } catch {
        /* A number that could not be allocated is not worth losing the
           customer over; the record screen fills it in later. */
      }
      onCreateCustomer(customer);
      setCreated(`${customer.company} added as a customer${customer.code ? ` (${customer.code})` : ""}.`);
      onDraft(applyCustomer(doc, customer, settings as DocSettings));
      return;
    }

    onDraft(doc);
  };

  const unpriced = report?.lines.filter((l) => l.needsPrice).length ?? 0;

  return (
    <Card title="Write it in words">
      <div className="stack">
        <Textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Quote ACME Infotech, 10 x Microsoft 365 Business Standard at 1,200 each, 20 x Acrobat Pro"
          onKeyDown={(e) => {
            /* Ctrl/Cmd+Enter, because Enter alone belongs to the next line
               of a multi-line description. */
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void run();
          }}
        />
        <div className="spread wrap">
          <span className="field-hint">
            Opens a draft for you to check. Nothing is saved or sent until you press Save.
          </span>
          <Button tone="primary" onClick={() => void run()} disabled={!text.trim() || busy}>
            {busy ? "Reading…" : "Draft a quotation"}
          </Button>
        </div>

        {error ? <p className="bad">{error}</p> : null}

        {report ? (
          <div className="stack">
            <p style={{ margin: 0 }}>
              {report.matchedCustomer
                ? <>Matched <strong>{report.matchedCustomer.company}</strong> on file.</>
                : created
                  ? <>{created}</>
                  : duplicate
                    ? <>{duplicate}</>
                    : report.unmatchedCustomerName
                      ? <>No customer on file matches <strong>{report.unmatchedCustomerName}</strong> — the details are filled in, but no customer record was created.</>
                      : <>No customer was named — pick one in the draft.</>}
            </p>
            {report.lines.length ? (
              <ul className="plain-list">
                {report.lines.map((l, i) => (
                  <li key={i}>
                    {l.desc}
                    {l.matchedProduct
                      ? <span className="muted"> — matched the catalog{l.priceFromText ? ", your price used" : ""}</span>
                      : <span className="muted"> — not in the catalog</span>}
                    {l.needsPrice ? <strong> — needs a price</strong> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {unpriced > 0 ? (
              <p className="bad" style={{ margin: 0 }}>
                {unpriced} line{unpriced === 1 ? "" : "s"} had no price in the catalog or in what you wrote.
                Nothing was guessed — fill them in before sending.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
