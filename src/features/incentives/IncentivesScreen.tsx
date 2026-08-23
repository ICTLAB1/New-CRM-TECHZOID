import { useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Card, Chip, Empty, Meter, Select, StatTile, SummaryBar } from "../../components/primitives";
import {
  activeSchemes, calcMetrics, computePayout, nextTarget,
  type IncentiveScheme,
} from "../../domain/incentives/incentives";
import { inr, inrShort } from "../../domain/currency/format";
import type { Workspace } from "../../domain/analytics/dashboard";

/**
 * What someone has earned.
 *
 * The figures come from the same records the dashboard reads, so a
 * salesperson can trace a payout back to the deals behind it. A scheme that
 * pays nothing yet says what is still needed rather than showing a zero and
 * leaving them to work it out.
 */

export interface IncentivesScreenProps {
  workspace: Workspace;
  settings: Record<string, unknown>;
  users: { id: string; name: string; role: string }[];
  currentUser: { id: string; name: string; role: string };
}

const canViewOthers = (role: string) => role === "Admin" || role === "Manager";

export function IncentivesScreen({ workspace, settings, users, currentUser }: IncentivesScreenProps) {
  const [viewing, setViewing] = useState(currentUser.id);
  const schemes = activeSchemes(settings["incentiveSchemes"] as IncentiveScheme[] | undefined);
  const person = users.find((u) => u.id === viewing) ?? currentUser;
  const mine = viewing === currentUser.id;

  return (
    <main className="page">
      <PageHead
        title={mine ? "My incentives" : `${person.name}'s incentives`}
        sub="Worked out from deals actually closed, not from targets typed in."
        actions={canViewOthers(currentUser.role) && users.length > 1 ? (
          <Select value={viewing} aria-label="Whose incentives to show" onChange={(e) => setViewing(e.target.value)}>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        ) : null}
      />

      {schemes.length === 0 ? (
        <Card>
          <Empty
            title="No scheme is running"
            body={currentUser.role === "Admin"
              ? "Settings → Incentives is where a scheme is created and switched on."
              : "Nothing is set up yet — worth asking your manager."}
          />
        </Card>
      ) : (
        <div className="stack">
          {schemes.map((scheme) => (
            <SchemeCard key={scheme.id} scheme={scheme} workspace={workspace} ownerId={viewing} />
          ))}
        </div>
      )}
    </main>
  );
}

function SchemeCard({ scheme, workspace, ownerId }: { scheme: IncentiveScheme; workspace: Workspace; ownerId: string }) {
  const metrics = calcMetrics(ownerId, scheme.period, workspace);
  const result = computePayout(scheme, metrics);
  const gap = nextTarget(result, metrics);

  return (
    <Card
      title={scheme.name}
      actions={
        <span className="row-tight">
          <Chip tone="neutral" dot={false}>{metrics.label}</Chip>
          <span className="value-lg mono">{inr(result.totalPayout)}</span>
        </span>
      }
    >
      {scheme.description ? <p className="muted" style={{ marginTop: 0 }}>{scheme.description}</p> : null}

      <SummaryBar columns={5}>
        <StatTile label="Revenue earned" value={inrShort(metrics.revenue)} />
        <StatTile label="Deals won" value={metrics.dealsWon} />
        <StatTile label="Quotations sent" value={metrics.quotationsSent} />
        <StatTile label="Renewals closed" value={metrics.renewals} />
        <StatTile label="New customers" value={metrics.newCustomers} />
      </SummaryBar>

      {result.breakdown.length === 0 ? (
        <div className="field-hint" style={{ marginTop: 14 }}>This scheme has no slabs, so it pays nothing.</div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Measured on</th><th className="num">Where you are</th><th>Target</th>
                <th>Qualified</th><th className="num">Pays</th>
              </tr>
            </thead>
            <tbody>
              {result.breakdown.map(({ slab, actual, qualified, payout }) => {
                const min = Number(slab.minTarget) || 0;
                const pct = min > 0 ? Math.min(100, (actual / min) * 100) : 100;
                const money = slab.metric === "Revenue";
                return (
                  <tr key={slab.id}>
                    <td>{slab.metric}</td>
                    <td className="num">{money ? inrShort(actual) : actual}</td>
                    <td style={{ minWidth: 150 }}>
                      <div className="muted">
                        {money ? inrShort(min) : min}
                        {slab.maxTarget ? ` – ${money ? inrShort(slab.maxTarget) : slab.maxTarget}` : " and above"}
                      </div>
                      {/* Progress against the slab's floor, so a slab still
                          out of reach shows how far, not just "no". */}
                      <Meter pct={pct} tone={qualified ? "good" : "warn"} />
                    </td>
                    <td>{qualified ? <Chip tone="good">Yes</Chip> : <Chip tone="neutral">Not yet</Chip>}</td>
                    <td className="num">{payout ? inr(payout) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {gap ? (
        <div className="notice" style={{ marginTop: 14 }}>
          <span>
            <strong>Still to go:</strong>{" "}
            {slabGapText(gap.gap, gap.slab.metric)} to qualify for the{" "}
            {gap.slab.payoutType === "Percentage"
              ? `${gap.slab.payoutValue}% slab`
              : `${inr(Number(gap.slab.payoutValue) + Number(gap.slab.bonusFlat || 0))} slab`}.
          </span>
        </div>
      ) : result.totalPayout > 0 ? (
        <div className="notice notice-good" style={{ marginTop: 14 }}>
          <span>Every slab in this scheme has been met.</span>
        </div>
      ) : null}
    </Card>
  );
}

const slabGapText = (gap: number, metric: string): string =>
  metric === "Revenue"
    ? `${inrShort(gap)} more in revenue`
    : `${gap} more ${metric.toLowerCase()}`;
