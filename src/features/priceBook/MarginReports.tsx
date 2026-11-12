import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip, Empty, Field, Input } from "../../components/primitives";
import { inr } from "../../domain/currency/format";
import { localISO } from "../../domain/dates";
import {
  oemMarginReport,
  sellerReport,
  thinnestDeals,
  type OemMarginRow,
  type SellerRow,
  type ThinDealRow,
} from "../../data/priceBook";
import { ORDINARY_DISTRIBUTOR_DISCOUNT_MAX } from "../../domain/priceBook/pricing";

/**
 * What the quoting is earning, for Admin and Manager.
 *
 * EVERY FIGURE RESTS ON ONE ASSUMPTION AND THE SCREEN SAYS SO. The buying
 * price is the reseller price less a distributor discount, and that
 * discount varies by deal — so the whole page is computed at one figure
 * the reader sets, and the figure is in front of them while they read it.
 * A margin report that quietly assumed 3.5% would be a report people
 * trusted and should not.
 *
 * ONLY LINES FROM THE PRICE BOOK ARE IN IT. A line somebody typed has no
 * cost to compare against, and averaging it in at zero cost would report a
 * 100% margin on work nobody has costed. The line counts are shown beside
 * the margins so the figures can be read for what they cover.
 */
export function MarginReports({ company }: { company: string }) {
  const today = localISO(new Date());
  const monthStart = today.slice(0, 8) + "01";

  const [pct, setPct] = useState("3.5");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [sellers, setSellers] = useState<SellerRow[]>([]);
  const [oems, setOems] = useState<OemMarginRow[]>([]);
  const [thin, setThin] = useState<ThinDealRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const discount = Number(pct) || 0;

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [a, b, c] = await Promise.all([
        sellerReport(company, from, to),
        oemMarginReport(company, discount, from, to),
        thinnestDeals(company, discount, from, to, 15),
      ]);
      setSellers(a);
      setOems(b);
      setThin(c);
    } catch (e) {
      setError((e as Error)?.message || "Those reports could not be read.");
    }
    setBusy(false);
  }, [company, discount, from, to]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const nothing = !sellers.length && !oems.length && !thin.length && !busy;

  return (
    <div className="stack">
      <Card title="What these are worked out at">
        <div className="row">
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field
            label="Distributor discount (%)"
            hint={`Every margin below assumes this. Usually 0 to ${ORDINARY_DISTRIBUTOR_DISCOUNT_MAX}.`}
          >
            <Input numeric value={pct} onChange={(e) => setPct(e.target.value)} />
          </Field>
          <Button tone="default" onClick={() => void load()} loading={busy} loadingLabel="Reading…">Refresh</Button>
        </div>
        <p className="field-hint">
          Only lines added from the price book are counted — a line typed by hand has no cost to compare
          against, and counting it at zero cost would read as pure profit.
        </p>
      </Card>

      {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

      {nothing ? (
        <Empty
          title="Nothing quoted from the price book in that window"
          body="Once quotations are built from the monthly lists, what they earn shows up here."
        />
      ) : null}

      {oems.length ? (
        <Card title="Margin by OEM" padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>OEM</th>
                  <th className="num">Quotations</th>
                  <th className="num">Lines</th>
                  <th className="num">Quoted</th>
                  <th className="num">Costs us</th>
                  <th className="num">Margin</th>
                </tr>
              </thead>
              <tbody>
                {oems.map((o) => (
                  <tr key={o.oem}>
                    <td data-label="OEM" className="strong">{o.oem}</td>
                    <td data-label="Quotations" className="num">{o.quotes}</td>
                    <td data-label="Lines" className="num">{o.lines}</td>
                    <td data-label="Quoted" className="num">{inr(o.revenue)}</td>
                    <td data-label="Costs us" className="num">{inr(o.cost)}</td>
                    <td data-label="Margin" className="num">
                      <Chip tone={(o.marginPct ?? 0) < 5 ? "bad" : (o.marginPct ?? 0) < 10 ? "warn" : "good"}>
                        {o.marginPct === null ? "—" : `${o.marginPct}%`}
                      </Chip>
                      <div className="muted">{o.markupPct === null ? "" : `${o.markupPct}% over cost`}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {thin.length ? (
        <Card title="Thinnest deals in the window" padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quotation</th>
                  <th>Customer</th>
                  <th>Raised by</th>
                  <th className="num">Quoted</th>
                  <th className="num">Margin</th>
                  <th>State</th>
                </tr>
              </thead>
              <tbody>
                {thin.map((d) => (
                  <tr key={d.quoteId}>
                    <td data-label="Quotation" className="strong">{d.quoteNumber || d.quoteId}</td>
                    <td data-label="Customer">{d.customer || "—"}</td>
                    <td data-label="Raised by">{d.seller}</td>
                    <td data-label="Quoted" className="num">{inr(d.revenue)}</td>
                    <td data-label="Margin" className="num">
                      <Chip tone={(d.marginPct ?? 0) < 5 ? "bad" : (d.marginPct ?? 0) < 10 ? "warn" : "good"}>
                        {d.marginPct === null ? "—" : `${d.marginPct}%`}
                      </Chip>
                    </td>
                    <td data-label="State"><span className="muted">{d.status || "—"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {sellers.length ? (
        <Card title="By salesperson" padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Who</th>
                  <th className="num">Quotations</th>
                  <th className="num">Quoted</th>
                  <th className="num">Asked to discount</th>
                  <th className="num">Granted</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((s) => (
                  <tr key={s.ownerId}>
                    <td data-label="Who" className="strong">{s.seller}</td>
                    <td data-label="Quotations" className="num">{s.quotes}</td>
                    <td data-label="Quoted" className="num">{inr(s.quotedValue)}</td>
                    <td data-label="Asked to discount" className="num">
                      {s.approvalsRequested}
                      {s.approvalsRequested && s.quotes ? (
                        <div className="muted">
                          on {Math.round((s.approvalsRequested / s.quotes) * 100)}% of their quotations
                        </div>
                      ) : null}
                    </td>
                    <td data-label="Granted" className="num">
                      {s.approvalsApproved}
                      {s.approvalsRejected ? <div className="muted">{s.approvalsRejected} refused</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
