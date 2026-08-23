import type { CSSProperties } from "react";
import type { DocumentModel, LogoSlot, Pair } from "../../domain/documents/model";
import { medallionNumber } from "../../domain/documents/model";
import type { ComputedRow } from "../../domain/tax/types";
import { CONTENT_WIDTH_MM } from "../../domain/documents/columns";

/**
 * The on-screen document.
 *
 * THE SECOND RENDERER. It reads the same DocumentModel the PDF does, and the
 * same column definitions — widths, alignment, type weight and the cell
 * getters that format every figure. Neither renderer decides what the
 * document says; both are handed it.
 *
 * That is the whole point. In v1 the preview and the PDF were built from
 * different code, drifted apart, and it took a byte-level comparison of a
 * generated file to notice. A test in this folder asserts every value the
 * model exposes actually appears in this markup.
 *
 * Only geometry differs, and even that is expressed in millimetres here so a
 * 22mm column is 22mm in both.
 */

export interface DocumentPreviewProps {
  model: DocumentModel;
  rows: ComputedRow[];
  /** Logo assets keyed by lower-cased brand name, for the items table. */
  brandLogos?: Record<string, { src: string }>;
  /** 1 = actual size. The editor scales to fit its pane. */
  scale?: number;
}

function Rows({ pairs }: { pairs: readonly Pair[] }) {
  const shown = pairs.filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!shown.length) return null;
  return (
    <dl className="doc-rows">
      {shown.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <span className="sep">:</span>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Slot({ slot }: { slot: LogoSlot }) {
  if (slot.src) {
    return (
      <div className="doc-slot">
        <img src={slot.src} alt={slot.text} />
      </div>
    );
  }
  if (slot.medallion) {
    return (
      <div className="doc-slot doc-cert">
        <span className="doc-medal" aria-hidden>
          <span className="doc-medal-inner">
            <b>ISO</b>
            <i>{medallionNumber(slot.text)}</i>
          </span>
        </span>
        <span>
          <span className="doc-cert-title">{slot.text}</span>
          {slot.caption ? <span className="doc-cert-scope" style={{ display: "block" }}>{slot.caption}</span> : null}
        </span>
      </div>
    );
  }
  return (
    <div className="doc-slot">
      <span className="doc-slot-text">{slot.text}</span>
    </div>
  );
}

export function DocumentPreview({ model: m, rows, brandLogos = {}, scale = 1 }: DocumentPreviewProps) {
  const cols = m.items.columns;
  const strips = [
    { title: "TECHNOLOGY PARTNER DESIGNATIONS", slots: m.strips.designations },
    { title: "OUR TECHNOLOGY PARTNERS", slots: m.strips.partners },
    { title: "CERTIFIED MANAGEMENT SYSTEMS", slots: m.strips.certifications },
  ].filter((s) => s.slots.length);

  return (
    <div className="doc-scale" style={{ transform: `scale(${scale})` } as CSSProperties}>
      <article className="doc-page">
        <header className="doc-head">
          <div>
            <div className="doc-mark">TECHZOID</div>
            <div className="doc-legal">{m.header.companyName.toUpperCase()}</div>
            <div className="doc-tagline">{m.header.tagline}</div>
          </div>
          <div style={{ width: "74mm", flex: "none" }}>
            <div className="doc-title">{m.title}</div>
            <div className="doc-plaque">{m.number}</div>
            <div className="doc-headmeta"><Rows pairs={m.header.meta} /></div>
          </div>
        </header>

        <hr className="doc-rule-navy" />

        <section className="doc-parties">
          <div>
            <div className="doc-block-title">{m.isProforma ? "INVOICE DETAILS" : "QUOTATION DETAILS"}</div>
            <Rows pairs={m.details} />
          </div>
          {m.parties.map((party) => (
            <div className="doc-party" key={party.heading}>
              <div className="doc-party-head">{party.heading}</div>
              <div className="doc-party-body">
                <div className="doc-party-name">{party.name}</div>
                {party.lines.map((line, i) => (
                  <div className="doc-party-line" key={i}>{line}</div>
                ))}
                <Rows pairs={party.rows} />
              </div>
            </div>
          ))}
        </section>

        {m.references.length ? (
          <section className="doc-refs" style={{ gridTemplateColumns: `repeat(${m.references.length}, 1fr)` }}>
            {m.references.map((cell) => (
              <div className="doc-ref" key={cell.label}>
                <div className="doc-ref-label">{cell.label.toUpperCase()}</div>
                <div className="doc-ref-value">{cell.value}</div>
              </div>
            ))}
          </section>
        ) : null}

        <table className="doc-items">
          <colgroup>
            {cols.map((c) => (
              <col key={c.key} style={{ width: `${(c.w / CONTENT_WIDTH_MM) * 100}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>{cols.map((c) => <th key={c.key}>{c.head}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id ?? i}>
                {cols.map((c) => {
                  const value = c.get(row, i);
                  const cls = [
                    `a-${c.align}`,
                    c.mono ? "mono" : "",
                    c.bold ? "bold" : "",
                    c.muted ? "muted" : "",
                    c.key === "desc" ? "desc" : "",
                  ].filter(Boolean).join(" ");
                  if (c.key === "desc") {
                    /* Product name bold, specification beneath it lighter —
                       the same hierarchy the PDF draws. */
                    const [title, ...rest] = value.split("\n");
                    return (
                      <td key={c.key} className={cls}>
                        <span style={{ fontWeight: 700, color: "#18202A" }}>{title}</span>
                        {rest.length ? (
                          <span style={{ display: "block", fontWeight: 400, color: "#64748B" }}>{rest.join("\n")}</span>
                        ) : null}
                      </td>
                    );
                  }
                  if (c.key === "brand") {
                    const logo = brandLogos[value.trim().toLowerCase()];
                    return (
                      <td key={c.key} className={cls}>
                        {logo ? <img className="doc-brand-logo" src={logo.src} alt={value} /> : value}
                      </td>
                    );
                  }
                  return <td key={c.key} className={cls}>{value}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <section className="doc-money">
          <div className="doc-terms">
            {m.money.terms.length ? (
              <>
                <div className="doc-block-title">TERMS &amp; CONDITIONS</div>
                <ol>{m.money.terms.map((t, i) => <li key={i}>{t}</li>)}</ol>
              </>
            ) : m.money.bank ? (
              <>
                <div className="doc-block-title">{m.money.bank.heading}</div>
                <Rows pairs={m.money.bank.rows} />
              </>
            ) : null}
          </div>

          <div className="doc-summary">
            <div className="doc-summary-head">SUMMARY</div>
            {m.money.rows.map((r) => (
              <div className="doc-sum-row" key={r.label}>
                <span>{r.label}</span>
                <span>{r.value}</span>
              </div>
            ))}
            {m.money.advance ? (
              <div className="doc-sum-row">
                <span>{m.money.advance.label}</span>
                <span>{m.money.advance.value}</span>
              </div>
            ) : null}
            <div className="doc-grand">
              <span>{m.money.grandLabel.toUpperCase()}</span>
              <span>{m.money.grandValue}</span>
            </div>
            {m.money.amountInWords ? (
              <div className="doc-words">
                <div className="doc-words-label">Amount in Words:</div>
                <div className="doc-words-value">{m.money.amountInWords}</div>
              </div>
            ) : null}
          </div>
        </section>

        {strips.length ? (
          <section className="doc-strips" style={{ gridTemplateColumns: `repeat(${strips.length}, 1fr)` }}>
            {strips.map((strip) => (
              <div className="doc-strip" key={strip.title}>
                <div className="doc-strip-title">{strip.title}</div>
                <div className="doc-slots">
                  {strip.slots.map((slot, i) => <Slot slot={slot} key={slot.text || i} />)}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        <hr className="doc-foot-rule" />
        <footer className="doc-foot">
          <div>
            <div className="doc-foot-name">{m.footer.companyName.toUpperCase()}</div>
            {m.footer.addressLines.map((line, i) => (
              <div className="doc-foot-line" key={i}>{line}</div>
            ))}
          </div>
          <div>
            {m.footer.contactBits.map((bit, i) => (
              <div className="doc-foot-line" key={i}>{bit}</div>
            ))}
          </div>
          <Rows pairs={m.footer.registration} />
        </footer>

        <div className="doc-closing">
          <span>{m.footer.closing}</span>
          <span>Page 1</span>
        </div>
      </article>
    </div>
  );
}
