import { useMemo, useState } from "react";
import { Modal } from "../../components/Modal";
import { Button, Card, Chip, Field, Select } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { parseCsv, type ParsedCsv } from "../../domain/outreach/csv";
import {
  FIELD_LABELS, PROSPECT_FIELDS, auditRows, inferMapping, PROBLEM_LABELS,
  type ImportAudit, type ProspectField,
} from "../../domain/outreach/importMap";
import { importProspects } from "../../data/outreach";

/**
 * Bringing a list of people into the CRM.
 *
 * THE POINT OF THIS SCREEN IS THE AUDIT, NOT THE UPLOAD. Anybody can read a
 * CSV. What stops a bad campaign is showing, before a single row is written,
 * exactly how many people will actually be written to and why the rest will
 * not — duplicates, addresses that failed verification, people already on the
 * suppression list. A tool that imports 1,000 rows and then sends to 840
 * without ever saying so is a tool nobody can trust with a stranger's inbox.
 *
 * Three steps, and the middle one is where the work happens:
 *
 *   1. Choose a file. Parsed in the browser; nothing is uploaded anywhere.
 *   2. Confirm the columns, and read the audit. The mapping is guessed and
 *      always shown — a guess presented as a fact is how the whole list ends
 *      up addressed by job title.
 *   3. Import what is importable.
 */

export interface ImportWizardProps {
  open: boolean;
  ownerId: string;
  /** Addresses already held, so the audit can say "already in the CRM". */
  existing: ReadonlySet<string>;
  suppressed: ReadonlySet<string>;
  onClose: () => void;
  onImported: () => void;
}

type Step = "file" | "map" | "done";

export function ImportWizard({ open, ownerId, existing, suppressed, onClose, onImported }: ImportWizardProps) {
  const toast = useToast();
  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ProspectField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  const audit: ImportAudit | null = useMemo(() => {
    if (!parsed || !mapping.email) return null;
    return auditRows(parsed.rows, mapping, { existing, suppressed });
  }, [parsed, mapping, existing, suppressed]);

  const reset = () => {
    setStep("file");
    setFileName("");
    setParsed(null);
    setMapping({});
    setResult(null);
  };

  const close = () => { reset(); onClose(); };

  async function readFile(file: File) {
    const text = await file.text();
    const out = parseCsv(text);

    if (!out.headers.length) {
      toast("That file has no columns this could read.", "bad");
      return;
    }

    setFileName(file.name);
    setParsed(out);
    /* Guessed, then SHOWN. Never applied silently. */
    setMapping(inferMapping(out.headers));
    setStep("map");

    if (out.ragged.length) {
      toast(
        `${out.ragged.length} row${out.ragged.length === 1 ? "" : "s"} had a different number of columns. ` +
          `They are still listed — check them before importing.`,
        "warn",
      );
    }
  }

  async function doImport() {
    if (!audit || !parsed) return;
    setBusy(true);
    try {
      const rows = audit.rows
        .filter((r) => r.importable)
        .map((r) => ({
          prospect: r.prospect,
          verificationStatus: r.verdict.status,
          verificationReason: r.verdict.reason,
        }));

      const out = await importProspects({
        ownerId,
        fileName,
        rows,
        rowCount: audit.total,
        skipped: audit.total - rows.length,
        summary: { counts: audit.counts, headers: parsed.headers },
      });

      setResult({ imported: out.imported, skipped: out.skipped });
      setStep("done");
      onImported();
    } catch (err) {
      toast(err instanceof Error ? err.message : "The import did not finish.", "bad");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Import prospects"
      description={
        step === "map"
          ? "Check the columns, then read what will actually be imported."
          : "A CSV from Apollo, Sales Navigator, a conference list — anything with an email column."
      }
      onClose={close}
      onSubmit={step === "map" && audit?.importable ? doImport : undefined}
      canSubmit={!busy}
      footer={
        step === "map" ? (
          <>
            <Button onClick={() => setStep("file")}>Back</Button>
            <Button
              tone="primary"
              loading={busy}
              disabled={!audit?.importable}
              onClick={doImport}
            >
              {audit?.importable
                ? `Import ${audit.importable} prospect${audit.importable === 1 ? "" : "s"}`
                : "Nothing to import"}
            </Button>
          </>
        ) : step === "done" ? (
          <Button tone="primary" onClick={close}>Done</Button>
        ) : (
          <Button onClick={close}>Cancel</Button>
        )
      }
    >
      {step === "file" ? (
        <Field label="Choose a file" hint="Read in your browser. Nothing is uploaded until you press Import.">
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </Field>
      ) : null}

      {step === "map" && parsed ? (
        <>
          <Card title="Columns" padded>
            <p className="muted small" style={{ marginTop: 0 }}>
              Guessed from the headings in <strong>{fileName}</strong>. Change anything that is wrong —
              an email column mapped to the wrong field is how a whole list goes out addressed to a job title.
            </p>
            <div className="grid grid-2">
              {PROSPECT_FIELDS.map((field) => (
                <Field
                  key={field}
                  label={FIELD_LABELS[field] + (field === "email" ? " (required)" : "")}
                  htmlFor={`map-${field}`}
                >
                  <Select
                    id={`map-${field}`}
                    value={mapping[field] ?? ""}
                    invalid={field === "email" && !mapping.email}
                    onChange={(e) =>
                      setMapping((m) => {
                        const next = { ...m };
                        if (e.target.value) next[field] = e.target.value;
                        else delete next[field];
                        return next;
                      })
                    }
                  >
                    <option value="">— not in this file —</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
          </Card>

          {!mapping.email ? (
            <Card title="Which column holds the email address?" padded>
              <p className="muted" style={{ margin: 0 }}>
                Nothing can be imported until that is chosen — an email address is the only field
                this feature genuinely cannot do without.
              </p>
            </Card>
          ) : audit ? (
            <AuditSummary audit={audit} />
          ) : null}
        </>
      ) : null}

      {step === "done" && result ? (
        <Card title="Imported" padded>
          <p style={{ marginTop: 0 }}>
            <strong>{result.imported}</strong> prospect{result.imported === 1 ? "" : "s"} added.
            {result.skipped > 0 ? ` ${result.skipped} were skipped.` : ""}
          </p>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Nothing has been emailed. Build a campaign when you are ready to write to them.
          </p>
        </Card>
      ) : null}
    </Modal>
  );
}

/**
 * The number that matters, and the arithmetic behind it.
 *
 * "1,000 rows → 842 will be imported" with the 158 broken down by reason, so
 * somebody can fix the file rather than wonder where their list went.
 */
function AuditSummary({ audit }: { audit: ImportAudit }) {
  const problems = (Object.keys(audit.counts) as (keyof typeof audit.counts)[])
    .map((k) => ({ key: k, count: audit.counts[k] }))
    .filter((p) => p.count > 0);

  const held = audit.total - audit.importable;

  return (
    <Card title="What will be imported" padded>
      <div className="row-tight wrap" style={{ marginBottom: 12 }}>
        <Chip tone="accent" solid>{audit.total} rows in the file</Chip>
        <Chip tone={audit.importable ? "good" : "bad"} solid>{audit.importable} will be imported</Chip>
        {held > 0 ? <Chip tone="warn">{held} held back</Chip> : null}
      </div>

      {problems.length ? (
        <table className="table compact">
          <thead>
            <tr><th>Why a row is held back</th><th className="num">Rows</th></tr>
          </thead>
          <tbody>
            {problems.map((p) => (
              <tr key={p.key}>
                <td>{PROBLEM_LABELS[p.key]}</td>
                <td className="num">{p.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>Every row looks usable.</p>
      )}

      <p className="muted small" style={{ marginBottom: 0 }}>
        A row can have more than one problem, so these will not add up to {held}.
        Nothing is emailed by importing — this only adds people to the list.
      </p>
    </Card>
  );
}
