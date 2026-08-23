import { useMemo } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Empty, Meter, StatTile, SummaryBar } from "../../components/primitives";
import {
  deliveriesInProgress, kpis, needsAttention, pipelineFunnel, scopeWorkspace,
  teamPerformance, trailingRevenue, type Workspace,
} from "../../domain/analytics/dashboard";
import { seesEverything } from "../../domain/analytics/scope";
import { STAGES } from "../../domain/pipeline/stages";
import { inrList, inrShort } from "../../domain/currency/format";

/** A bar chart drawn as divs: six months of revenue does not need a
 *  charting library, and one would weigh more than this whole screen. */
function RevenueBars({ points }: { points: { key: string; label: string; value: number; count: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div className="row" style={{ alignItems: "flex-end", gap: "var(--gap)", height: 130 }}>
      {points.map((p) => (
        <div key={p.key} className="grow" style={{ textAlign: "center", minWidth: 0 }}>
          <div className="field-hint" style={{ marginBottom: 4 }}>{p.value ? inrShort(p.value) : ""}</div>
          <div
            title={`${p.count} deal${p.count === 1 ? "" : "s"}`}
            style={{
              height: Math.max(2, (p.value / max) * 86),
              background: p.value ? "var(--accent)" : "var(--surface-3)",
              borderRadius: "2px 2px 0 0",
            }}
          />
          <div className="field-hint" style={{ marginTop: 5 }}>{p.label}</div>
        </div>
      ))}
    </div>
  );
}

export function DashboardScreen({
  workspace, users, currentUser, settings, onNavigate,
}: {
  workspace: Workspace;
  users: { id: string; name: string }[];
  currentUser: { id: string; name: string; role: string };
  settings: Record<string, unknown>;
  onNavigate: (view: string) => void;
}) {
  const sellerState = ((settings["company"] as { state?: string })?.state) ?? "Delhi";

  /* Everything below reads the scoped workspace. A Sales user's dashboard
     must not total rows the database would not have returned to them. */
  const ws = useMemo(() => scopeWorkspace(workspace, currentUser), [workspace, currentUser]);
  const k = useMemo(() => kpis(ws, sellerState), [ws, sellerState]);
  const attention = useMemo(() => needsAttention(ws, sellerState), [ws, sellerState]);
  const revenue = useMemo(() => trailingRevenue(ws), [ws]);
  const funnel = useMemo(() => pipelineFunnel(ws, STAGES), [ws]);
  const team = useMemo(() => teamPerformance(ws, users), [ws, users]);
  const deliveries = useMemo(() => deliveriesInProgress(ws), [ws]);
  const wide = seesEverything(currentUser.role);
  const funnelMax = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <main className="page">
      <PageHead
        title={`Good morning, ${currentUser.name.split(" ")[0]}`}
        sub={wide ? "Everything across the team." : "Your accounts and documents."}
      />

      <div style={{ marginBottom: "var(--gap-wide)" }}>
        <SummaryBar columns={5}>
          <StatTile label="Open pipeline" value={inrShort(k.openPipeline)} meta={`${k.openDeals} deal${k.openDeals === 1 ? "" : "s"}`} onClick={() => onNavigate("pipeline")} />
          <StatTile label="Won this month" value={inrShort(k.wonThisMonth)} meta={`${k.wonThisMonthCount} deal${k.wonThisMonthCount === 1 ? "" : "s"}`} tone="good" onClick={() => onNavigate("pipeline")} />
          <StatTile label="Quotes pending" value={String(k.quotesPending)} meta={k.quotesStale ? `${k.quotesStale} past validity` : "all in date"} tone={k.quotesStale ? "warn" : undefined} onClick={() => onNavigate("quotations")} />
          <StatTile label="Payments due" value={inrShort(k.paymentsDue)} meta={k.paymentsOverdue ? `${k.paymentsOverdue} overdue` : "none overdue"} tone={k.paymentsOverdue ? "bad" : undefined} onClick={() => onNavigate("proformas")} />
          <StatTile label="Renewals ≤30 days" value={String(k.renewalsDue)} meta={`${inrShort(k.renewalsValue)} at risk`} tone={k.renewalsDue ? "warn" : undefined} onClick={() => onNavigate("renewals")} />
        </SummaryBar>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1fr)", marginBottom: "var(--gap-wide)" }}>
        <Card
          title="Needs attention"
          edge={attention.some((a) => a.tone === "bad") ? "bad" : attention.length ? "warn" : undefined}
          padded={false}
        >
          {/* Whole rows, with a count of the rest. A fixed pixel height cut the
              last row through the middle of its text, which reads as broken
              rather than as scrollable. */}
          {attention.length === 0 ? (
            <Empty title="Nothing needs you right now" body="No overdue payments, follow-ups, stale quotations or renewals inside thirty days." />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {attention.slice(0, 6).map((row) => (
                    <tr key={`${row.kind}-${row.id}`} className={row.tone === "bad" ? "needs-bad" : "needs-warn"} style={{ cursor: "pointer" }} onClick={() => onNavigate(row.view)}>
                      <td className="edge-cell" />
                      <td>
                        <div className="strong">{row.title}</div>
                        <div className="field-hint">{row.detail}</div>
                      </td>
                      <td className="num strong">{row.value ? inrList(row.value) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {attention.length > 6 ? (
                <div style={{ padding: "9px var(--gap-wide)", borderTop: "1px solid var(--rule)" }}>
                  <span className="field-hint">
                    {attention.length - 6} more item{attention.length - 6 === 1 ? "" : "s"} need attention.
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <Card title="Revenue, last six months" actions={<span className="field-hint">from the date each deal was won</span>}>
          <RevenueBars points={revenue} />
        </Card>
      </div>

      <div className="grid grid-3" style={{ alignItems: "start" }}>
        <Card title="Pipeline">
          <div className="stack">
            {funnel.map((step) => (
              <div key={step.id}>
                <div className="spread" style={{ marginBottom: 3 }}>
                  <span className="field-hint">{step.label}</span>
                  <span className="field-hint">{step.count} · {inrShort(step.value)}</span>
                </div>
                <Meter pct={(step.count / funnelMax) * 100} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Deliveries in progress" padded={false}>
          {deliveries.length === 0 ? (
            <Empty title="Nothing in transit" />
          ) : (
            <table className="table">
              <tbody>
                {deliveries.slice(0, 6).map((d) => (
                  <tr key={d.id} onClick={() => onNavigate("orders")} style={{ cursor: "pointer" }}>
                    <td>
                      <div className="strong">{d.customer}</div>
                      <div className="field-hint mono">{d.number} · {d.stage}</div>
                    </td>
                    <td style={{ width: 90 }}>
                      <Meter pct={d.pct} tone={d.pct === 100 ? "good" : undefined} />
                      <div className="field-hint">{d.pct}%</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {wide ? (
          <Card title="Team" padded={false}>
            <table className="table">
              <thead>
                <tr><th>Person</th><th className="num">Open</th><th className="num">Won (6m)</th></tr>
              </thead>
              <tbody>
                {team.map((t) => (
                  <tr key={t.ownerId}>
                    <td className="strong">{t.name}</td>
                    <td className="num">{inrShort(t.openValue)}</td>
                    <td className="num strong">{inrShort(t.wonValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : (
          <Card title="Your quotations">
            <div className="value-lg">{ws.quotations.length}</div>
            <div className="field-hint">{k.quotesPending} awaiting a decision</div>
            <div style={{ marginTop: "var(--gap-wide)" }}>
              <Button tone="default" onClick={() => onNavigate("quotations")}>Open quotations</Button>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
