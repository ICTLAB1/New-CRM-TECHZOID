import { greeting } from "../../domain/dates";
import { useMemo, useState } from "react";
import { Button, Card, Chip, Empty, Meter, StatTile, SummaryBar } from "../../components/primitives";
import {
  deliveriesInProgress, kpis, needsAttention, pipelineFunnel, scopeWorkspace,
  teamPerformance, trailingRevenue, type Workspace,
} from "../../domain/analytics/dashboard";
import { seesEverything } from "../../domain/analytics/scope";
import { STAGES } from "../../domain/pipeline/stages";
import { formatTotals, inrShort, moneyList, moneyShort } from "../../domain/currency/format";
import { changeBetween, donutArcs, groupActivities, type Slice } from "./dashboardView";

/**
 * The Sales Command Centre.
 *
 * REBUILT IN NOVEMBER 2026 to a reference design the company supplied: a
 * hero band, four tinted headline tiles, the revenue trend beside the
 * pipeline as a ring, and panels underneath for what needs doing, which
 * deals are slipping, and how the team is tracking.
 *
 * NOT ONE FIGURE ON IT IS NEW. Every number here was already computed in
 * domain/analytics/dashboard.ts and was already on this screen in some
 * form; what changed is what it looks like and the order it is read in.
 * That was deliberate — a redesign that also changes the arithmetic is
 * two changes at once, and when a total looks wrong afterwards nobody
 * can say which of them did it.
 */

/* ── the glyphs ───────────────────────────────────────────────────────
   Drawn here rather than installed, on the same grid and stroke as the
   rail's icons in app/NavIcon.tsx, so the two sets read as one family. */
const G = {
  width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true,
};
const IconLayers = () => <svg {...G}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>;
const IconTrophy = () => <svg {...G}><path d="M8 4h8v5a4 4 0 0 1-8 0Z" /><path d="M8 5H5v1a3 3 0 0 0 3 3M16 5h3v1a3 3 0 0 1-3 3" /><path d="M12 13v4M9 21h6l-.6-4h-4.8Z" /></svg>;
const IconDoc = () => <svg {...G}><path d="M14 3v5h5" /><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7Z" /><path d="M9 13h6M9 17h4" /></svg>;
const IconCard = () => <svg {...G}><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19" /></svg>;
const IconBell = () => <svg {...G}><path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7Z" /><path d="M10.5 19a2 2 0 0 0 3 0" /></svg>;
const IconWarn = () => <svg {...G}><path d="M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>;
const IconUsers = () => <svg {...G}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 11a3 3 0 1 0 0-6" /><path d="M18 20c0-2.4-.9-4.2-2.3-5.3" /></svg>;
const IconRing = () => <svg {...G}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /></svg>;
const IconChart = () => <svg {...G}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;

/** A bar chart drawn as divs: six months of revenue does not need a
 *  charting library, and one would weigh more than this whole screen. */
function RevenueBars({ points, mode }: {
  points: { key: string; label: string; value: number; count: number }[];
  mode: "revenue" | "deals";
}) {
  const read = (p: { value: number; count: number }) => (mode === "revenue" ? p.value : p.count);
  const max = Math.max(1, ...points.map(read));
  return (
    <div className="bars">
      {points.map((p, i) => {
        const v = read(p);
        const last = i === points.length - 1;
        return (
          <div key={p.key} className="bar-col">
            <div className="bar-figure">{v ? (mode === "revenue" ? inrShort(v) : String(v)) : ""}</div>
            <div className="bar-track">
              <div
                className={`bar-grow bar${last ? " is-last" : ""}`}
                title={`${p.count} deal${p.count === 1 ? "" : "s"}`}
                style={{ animationDelay: `${120 + i * 70}ms`, height: `${Math.max(2, (v / max) * 100)}%` }}
              />
            </div>
            <div className="bar-label">{p.label}</div>
          </div>
        );
      })}
    </div>
  );
}

/** The open pipeline as a ring, with the legend beside it. */
function PipelineRing({ slices, total, totalLabel, onPick }: {
  slices: Slice[]; total: number; totalLabel: string; onPick: () => void;
}) {
  const arcs = donutArcs(slices);
  return (
    <div className="ring-wrap">
      <div className="ring">
        <svg viewBox="0 0 42 42" aria-hidden focusable="false">
          <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--surface-3)" strokeWidth="6" />
          {arcs.map((a) => (
            <circle
              key={a.id} className="ring-arc" cx="21" cy="21" r="15.9"
              stroke={a.colour} strokeWidth="6" fill="none"
              strokeDasharray={`${a.length} ${100 - a.length}`}
              strokeDashoffset={a.offset}
            />
          ))}
        </svg>
        <div className="ring-centre">
          <div className="ring-total">{total}</div>
          <div className="ring-total-label">Deals</div>
          <div className="ring-total-value">{totalLabel}</div>
        </div>
      </div>
      <ul className="ring-legend">
        {slices.map((s) => (
          <li key={s.id}>
            <button type="button" className="legend-row" onClick={onPick}>
              <span className="legend-dot" style={{ background: s.colour }} aria-hidden />
              <span className="legend-label">{s.label}</span>
              <span className="legend-count">{s.count}</span>
              <span className="legend-value">{s.valueLabel}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What each kind of attention row is called inside its chip. */
const KIND_LABEL: Record<string, string> = {
  "overdue-proforma": "Payment due",
  "follow-up": "Follow-up",
  "stale-quotation": "Quotation",
  renewal: "Renewal",
  "unbacked-win": "Unbacked win",
  "won-mismatch": "Check figure",
};

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
  const [trendMode, setTrendMode] = useState<"revenue" | "deals">("revenue");

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

  const first = (currentUser.name.split(" ")[0] ?? "").toUpperCase();
  const thisMonth = new Date().toLocaleDateString("en-IN", { month: "short", year: "numeric" });

  /* THE ONLY TREND ON THIS SCREEN THAT IS MEASURED. This month's revenue
     against last month's, out of the same series the chart draws. The
     other three figures have no stored history to compare against, so
     they carry no trend rather than an invented one: a made-up
     percentage on a dashboard is worse than a blank space, because
     somebody will quote it in a meeting. */
  const revTrend = changeBetween(revenue.at(-2)?.value ?? 0, revenue.at(-1)?.value ?? 0);
  const spark = revenue.map((p) => p.value);

  const open = funnel.filter((f) => f.id !== "won" && f.id !== "lost");
  const openCount = open.reduce((n, f) => n + f.count, 0);
  const slices: Slice[] = open.map((f, i) => ({
    id: f.id,
    label: f.label,
    count: f.count,
    valueLabel: formatTotals(f.totals, moneyShort) || "—",
    colour: `var(--stage-${Math.min(5, i + 1)})`,
  }));

  const activities = groupActivities(attention);

  const deliveriesCard = (
    <Card
      title={<><span className="card-dot" style={{ background: "var(--obj-4)" }} aria-hidden><IconDoc /></span>Deliveries in progress</>}
      actions={<Button tone="quiet" size="sm" onClick={() => onNavigate("orders")}>Open orders</Button>}
      padded={false}
    >
      {deliveries.length === 0 ? (
        <div className="card-pad"><Empty title="Nothing in transit" /></div>
      ) : (
        <table className="table">
          <tbody>
            {deliveries.slice(0, 6).map((d) => (
              <tr key={d.id} onClick={() => onNavigate("orders")} style={{ cursor: "pointer" }}>
                <td>
                  {/* A <tr onClick> gives a mouse a huge target and a
                      keyboard nothing. The row keeps its click as a
                      convenience; this is the control that can be
                      tabbed to. */}
                  <button type="button" className="row-open" onClick={(e) => { e.stopPropagation(); onNavigate("orders"); }}>
                    {d.customer}
                  </button>
                  <div className="field-hint mono">{d.number} · {d.stage}</div>
                </td>
                <td style={{ width: 130 }}>
                  <Meter pct={d.pct} tone={d.pct === 100 ? "good" : undefined} />
                  <div className="field-hint">{d.pct}%</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );

  return (
    <main className="page">
      {/* ── the hero band ───────────────────────────────────────────────
          A GRADIENT, NOT A PHOTOGRAPH. The reference carries a building
          behind this band. There is no such image in this repository,
          and inventing one — a generated building, or somebody else's
          stock photograph — would put a picture on this company's screen
          that they do not own. The brand gradient is the honest stand-in,
          and a real photograph of theirs drops in behind it whenever
          they have one: see .hero in components.css. */}
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-ink">
          <h1 id="hero-title" className="hero-title">Sales Command Centre</h1>
          <p className="hero-sub">Pipeline&nbsp; |&nbsp; Performance&nbsp; |&nbsp; Revenue&nbsp; |&nbsp; Team</p>
        </div>
      </section>

      <div className="greet-row">
        <div>
          <h2 className="greet">{greeting()}, <span className="greet-name">{first}</span></h2>
          <p className="greet-sub">
            {wide ? "Here's what's happening across the team today." : "Here's what's happening with your sales today."}
          </p>
        </div>
        <span className="month-pill">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
          </svg>
          {thisMonth}
        </span>
      </div>

      <div style={{ marginBottom: "var(--gap-block)" }}>
        <SummaryBar columns={4}>
          <StatTile
            label="Open Pipeline"
            value={formatTotals(k.openPipeline, moneyShort) || "—"}
            meta={`${k.openDeals} deal${k.openDeals === 1 ? "" : "s"}`}
            icon={<IconLayers />}
            onClick={() => onNavigate("pipeline")}
          />
          <StatTile
            label="Won This Month"
            value={formatTotals(k.wonThisMonth, moneyShort) || "—"}
            meta={`${k.wonThisMonthCount} deal${k.wonThisMonthCount === 1 ? "" : "s"}`}
            tone="good"
            icon={<IconTrophy />}
            trend={revTrend ? { text: revTrend.text, direction: revTrend.direction, good: revTrend.direction === "up" } : undefined}
            spark={spark}
            onClick={() => onNavigate("pipeline")}
          />
          <StatTile
            label="Quotes Pending"
            value={String(k.quotesPending)}
            meta={k.quotesStale ? `${k.quotesStale} past validity` : "all in date"}
            tone={k.quotesStale ? "warn" : undefined}
            icon={<IconDoc />}
            onClick={() => onNavigate("quotations")}
          />
          <StatTile
            label="Payments Due"
            value={formatTotals(k.paymentsDue, moneyShort) || "—"}
            meta={k.paymentsOverdue ? `${k.paymentsOverdue} overdue` : "none overdue"}
            tone={k.paymentsOverdue ? "bad" : undefined}
            icon={<IconCard />}
            onClick={() => onNavigate("receivables")}
          />
        </SummaryBar>
      </div>

      <div className="grid grid-dash3" style={{ marginBottom: "var(--gap-block)" }}>
        <Card
          title={<><span className="card-dot" style={{ background: "var(--brand)" }} aria-hidden><IconChart /></span>Revenue Trend</>}
          actions={
            <span className="seg" role="group" aria-label="What the chart shows">
              <button type="button" className="seg-btn" aria-pressed={trendMode === "revenue"} onClick={() => setTrendMode("revenue")}>Revenue</button>
              <button type="button" className="seg-btn" aria-pressed={trendMode === "deals"} onClick={() => setTrendMode("deals")}>Deals</button>
            </span>
          }
        >
          <div className="row-tight wrap" style={{ alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            <span className="headline-figure">
              {trendMode === "revenue" ? inrShort(revenue.at(-1)?.value ?? 0) : String(revenue.at(-1)?.count ?? 0)}
            </span>
            {revTrend && trendMode === "revenue" ? (
              <span className={`tile-trend ${revTrend.direction === "up" ? "is-up" : revTrend.direction === "down" ? "is-down" : "is-flat"}`}>
                <span aria-hidden>{revTrend.direction === "up" ? "▲" : revTrend.direction === "down" ? "▼" : "—"}</span>
                {revTrend.text} vs last month
              </span>
            ) : null}
          </div>
          <RevenueBars points={revenue} mode={trendMode} />
        </Card>

        <Card title={<><span className="card-dot" style={{ background: "var(--obj-6)" }} aria-hidden><IconRing /></span>Sales Pipeline</>}>
          {openCount === 0 ? (
            <Empty title="Nothing open" body="Every deal is concluded — won or lost." />
          ) : (
            <PipelineRing
              slices={slices}
              total={openCount}
              totalLabel={formatTotals(k.openPipeline, moneyShort) || "—"}
              onPick={() => onNavigate("pipeline")}
            />
          )}
        </Card>

        <Card
          title={<><span className="card-dot" style={{ background: "var(--obj-5)" }} aria-hidden><IconBell /></span>My Activities</>}
          actions={<button type="button" className="link-btn" onClick={() => onNavigate("tasks")}>View all →</button>}
          padded={false}
        >
          {activities.length === 0 ? (
            <div className="card-pad"><Empty title="Nothing waiting" body="No follow-ups, stale quotations or overdue money." /></div>
          ) : (
            <ul className="activity-list">
              {activities.map((a) => (
                <li key={a.id}>
                  <button type="button" className="activity-row" onClick={() => onNavigate(a.view)}>
                    <span className={`activity-icon is-${a.tone}`} aria-hidden><IconWarn /></span>
                    <span className="activity-count">{a.count}</span>
                    <span className="activity-label">{a.label}</span>
                    <span className="activity-go" aria-hidden>›</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-dash2">
        <Card
          title={<><span className="card-dot" style={{ background: "var(--warn)" }} aria-hidden><IconWarn /></span>Deals Needing Attention</>}
          actions={<button type="button" className="link-btn" onClick={() => onNavigate("pipeline")}>View all →</button>}
          padded={false}
        >
          {attention.length === 0 ? (
            <div className="card-pad"><Empty title="Nothing needs you right now" body="No overdue payments, follow-ups, stale quotations or renewals inside thirty days." /></div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Opportunity / customer</th>
                    <th className="num">Amount</th>
                    <th>What it is</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.slice(0, 6).map((row) => (
                    <tr key={`${row.kind}-${row.id}`} style={{ cursor: "pointer" }} onClick={() => onNavigate(row.view)}>
                      <td>
                        <button type="button" className="row-open" onClick={(e) => { e.stopPropagation(); onNavigate(row.view); }}>
                          {row.title}
                        </button>
                      </td>
                      <td className="num strong">{row.value ? moneyList(row.value, row.currency) : "—"}</td>
                      <td><Chip tone={row.tone} solid>{KIND_LABEL[row.kind] ?? row.kind}</Chip></td>
                      <td className={row.tone === "bad" ? "due-late" : "muted"}>{row.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {attention.length > 6 ? (
                <div className="card-foot">
                  <span className="field-hint">
                    {attention.length - 6} more item{attention.length - 6 === 1 ? " needs" : "s need"} attention.
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </Card>

        {wide ? (
          <Card
            title={<><span className="card-dot" style={{ background: "var(--obj-1)" }} aria-hidden><IconUsers /></span>Team Performance <span className="card-title-sub">· 6 months</span></>}
            actions={<button type="button" className="link-btn" onClick={() => onNavigate("reports")}>View report →</button>}
            padded={false}
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Team member</th>
                    <th className="num">Deals</th>
                    <th className="num">Won</th>
                    <th style={{ width: 150 }}>Share of the team</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((t) => {
                    /* SHARE OF WHAT THE TEAM WON, not of a target. No
                       target is stored in this screen's data, and a bar
                       drawn against an invented one is a number somebody
                       plans from. The column says which it is. */
                    const mine = t.wonTotals.reduce((a, c) => a + c.total, 0);
                    const all = Math.max(1, team.reduce((a, r) => a + r.wonTotals.reduce((n, c) => n + c.total, 0), 0));
                    const pct = Math.round((mine / all) * 100);
                    return (
                      <tr key={t.ownerId}>
                        <td className="strong">{t.name}</td>
                        <td className="num">{t.wonDeals}</td>
                        <td className="num strong">{formatTotals(t.wonTotals, moneyShort) || "—"}</td>
                        <td>
                          <Meter pct={pct} tone="good" />
                          <div className="field-hint">{pct}%</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ) : deliveriesCard}
      </div>

      {wide ? <div style={{ marginTop: "var(--gap-block)" }}>{deliveriesCard}</div> : null}
    </main>
  );
}
