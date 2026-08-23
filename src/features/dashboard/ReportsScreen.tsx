import { useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Empty, Select, Tabs } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { scopeWorkspace, type Workspace } from "../../domain/analytics/dashboard";
import { csvFilename, downloadCsv, objectsToCsv, type CsvValue } from "../../domain/reports/csv";
import { buildReports, type Report } from "../../domain/reports/reports";
import { TODAY } from "../../domain/dates";
import { inrList } from "../../domain/currency/format";

/**
 * Reports.
 *
 * One table component, ten report definitions. v1 had a bespoke component
 * per report, which is why adding the eleventh was daunting and why three of
 * them exported different column sets from what they displayed.
 */
export function ReportsScreen({
  workspace, users, currentUser, settings,
}: {
  workspace: Workspace;
  users: { id: string; name: string }[];
  currentUser: { id: string; name: string; role: string };
  settings: Record<string, unknown>;
}) {
  const toast = useToast();
  const sellerState = ((settings["company"] as { state?: string })?.state) ?? "Delhi";
  const [active, setActive] = useState("revenue");
  const [months, setMonths] = useState("6");

  const reports = useMemo(
    () => buildReports(scopeWorkspace(workspace, currentUser), users, sellerState, Number(months)),
    [workspace, users, currentUser, sellerState, months],
  );

  const report: Report | undefined = reports.find((r) => r.id === active) ?? reports[0];

  const exportCsv = () => {
    if (!report) return;
    const csv = objectsToCsv(report.columns, report.rows as Record<string, CsvValue>[]);
    downloadCsv(csvFilename(report.title, TODAY()), csv);
    toast(`Exported ${report.rows.length} row${report.rows.length === 1 ? "" : "s"} to CSV.`, "good");
  };

  return (
    <main className="page">
      <PageHead
        title="Reports"
        sub={report?.description}
        actions={
          <>
            <Select style={{ maxWidth: 150 }} value={months} onChange={(e) => setMonths(e.target.value)}>
              <option value="3">Last 3 months</option>
              <option value="6">Last 6 months</option>
              <option value="12">Last 12 months</option>
            </Select>
            <Button tone="primary" onClick={exportCsv} disabled={!report?.rows.length}>Export CSV</Button>
          </>
        }
      />

      <Card padded={false}>
        <div style={{ padding: "0 var(--gap-wide)", overflowX: "auto" }}>
          <Tabs
            active={report?.id ?? ""}
            onChange={setActive}
            tabs={reports.map((r) => ({ id: r.id, label: r.title, count: r.rows.length }))}
          />
        </div>

        {!report || report.rows.length === 0 ? (
          <Empty title="Nothing to report yet" body="This report has no rows for the period selected." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {report.columns.map((c) => (
                    <th key={c.key} className={c.money || c.number ? "num" : undefined}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={i}>
                    {report.columns.map((c) => {
                      const value = row[c.key];
                      return (
                        <td key={c.key} className={c.money || c.number ? "num" : undefined}>
                          {c.money ? (Number(value) ? inrList(Number(value)) : "—") : (value ?? "—")}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {report.total ? (
                <tfoot>
                  <tr>
                    {report.columns.map((c, i) => (
                      <td key={c.key} className={`strong ${c.money || c.number ? "num" : ""}`}>
                        {i === 0 ? "Total" : c.money ? inrList(report.total?.[c.key] ?? 0) : c.number ? String(report.total?.[c.key] ?? "") : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </Card>

      <p className="field-hint" style={{ marginTop: "var(--gap-wide)" }}>
        Every report shows exactly what it exports — the CSV is built from the same column
        definitions this table renders.
      </p>
    </main>
  );
}
