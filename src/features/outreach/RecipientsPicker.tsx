import { useMemo, useState } from "react";
import { Button, Card, Chip, Empty, Field, Input, Tabs, Textarea } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { ImportWizard } from "./ImportWizard";
import { SampleDownload } from "./SampleDownload";
import { enrichFromAddress, parsePastedList, pasteSummary } from "../../domain/outreach/paste";
import { importProspects, type ProspectRow } from "../../data/outreach";
import { isEligible } from "../../domain/outreach/verify";

/**
 * Choosing who a campaign goes to.
 *
 * WHY EVERY ROUTE ENDS IN THE PROSPECT TABLE. Pasting forty addresses feels
 * like it should just attach them to the campaign, and it deliberately does
 * not: it creates prospects first, then selects them. Three things depend on
 * a prospect row existing —
 *
 *   * the suppression check, which is keyed on people this CRM knows about;
 *   * the unsubscribe link, which marks the prospect so no future campaign
 *     writes to them either;
 *   * the send queue itself, whose prospect_id is a real foreign key.
 *
 * A "just send to these addresses" shortcut would bypass all three, and the
 * first time somebody pasted a list containing an address that had already
 * unsubscribed, this company would write to them again. The detour is the
 * feature.
 *
 * Three ways in, because the three are genuinely different jobs: pasting is
 * for the fifteen addresses somebody has in an email, importing is for the
 * thousand-row export, and choosing is for the people already here.
 */

type Mode = "paste" | "import" | "choose";

export interface RecipientsPickerProps {
  ownerId: string;
  /** Everybody already in the CRM, for the "choose" tab and the audit. */
  prospects: ProspectRow[];
  suppressed: ReadonlySet<string>;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** Called after new prospects are written, so the parent reloads. */
  onImported: (newIds: string[]) => void;
}

export function RecipientsPicker({
  ownerId, prospects, suppressed, selected, onSelectedChange, onImported,
}: RecipientsPickerProps) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>(prospects.length ? "choose" : "paste");
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [query, setQuery] = useState("");

  const parsed = useMemo(() => parsePastedList(pasted), [pasted]);

  /* A bare address still carries a company (its domain) and usually a first
     name (its local part). Without filling those in, a pasted list cannot use
     any template that mentions either — which is all of them — and every
     recipient is held back for missing data. What was inferred is listed
     below the box rather than slipped in quietly. */
  const enriched = useMemo(() => parsed.people.map(enrichFromAddress), [parsed.people]);
  const summary = pasteSummary({ ...parsed, people: enriched });

  const inferredNames = enriched.filter((p) => p.derived.includes("first name")).length;
  const inferredCompanies = enriched.filter((p) => p.derived.includes("company")).length;
  const stillNameless = enriched.filter((p) => p.verdict.eligible && !p.firstName.trim()).length;

  /* Someone pasting a list has usually pasted it before. Saying so up front
     stops "why did 40 become 12" being a surprise after the fact. */
  const alreadyHere = useMemo(() => {
    const known = new Set(prospects.map((p) => p.email.toLowerCase()));
    return parsed.people.filter((p) => known.has(p.email.toLowerCase())).length;
  }, [parsed.people, prospects]);

  const onSuppressionList = useMemo(
    () => parsed.people.filter((p) => suppressed.has(p.email.toLowerCase())).length,
    [parsed.people, suppressed],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prospects.slice(0, 200);
    return prospects
      .filter((p) => [p.email, p.company, p.fullName].some((v) => v.toLowerCase().includes(q)))
      .slice(0, 200);
  }, [prospects, query]);

  async function addPasted() {
    const usable = enriched.filter((p) => p.verdict.eligible);
    if (!usable.length) return;

    setSaving(true);
    try {
      const out = await importProspects({
        ownerId,
        fileName: "Pasted list",
        rows: usable.map((p) => ({
          prospect: {
            email: p.email,
            firstName: p.firstName,
            lastName: p.lastName,
            fullName: p.fullName,
            jobTitle: "",
            company: p.company ?? "",
            companyDomain: p.email.split("@")[1] ?? "",
            phone: "", mobile: "", linkedin: "",
            industry: "", country: "", city: "",
            extra: {},
          },
          verificationStatus: p.verdict.status,
          verificationReason: p.verdict.reason,
        })),
        rowCount: enriched.length,
        skipped: enriched.length - usable.length,
        summary: { source: "paste", unreadable: parsed.unreadable.length, duplicates: parsed.duplicates.length },
      });

      /* Some of the pasted list was already here, so the count written is
         smaller than the count pasted. Say which happened rather than
         reporting a number that looks like a loss. */
      toast(
        out.imported === usable.length
          ? `${out.imported} added.`
          : `${out.imported} added. ${usable.length - out.imported} were already in the CRM.`,
        "good",
      );

      setPasted("");
      onImported([]);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Those addresses could not be saved.", "bad");
    } finally {
      setSaving(false);
    }
  }

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectedChange(next);
  };

  const sendable = prospects.filter((p) => !p.quarantined && isEligible(p.verificationStatus));

  return (
    <Card
      title="Who to write to"
      actions={
        selected.size ? (
          <Chip tone="accent" solid>{selected.size} chosen</Chip>
        ) : (
          <Chip tone="neutral">everyone sendable — {sendable.length}</Chip>
        )
      }
      padded
    >
      <Tabs<Mode>
        tabs={[
          { id: "paste", label: "Paste addresses" },
          { id: "import", label: "Upload a file" },
          { id: "choose", label: "Choose from the list", count: prospects.length },
        ]}
        active={mode}
        onChange={setMode}
      />

      {mode === "paste" ? (
        <>
          <Field
            label="Paste addresses"
            hint="One per line, or separated by commas or semicolons. Ravi Sharma <ravi@acme.example> works too — the name is kept and used in the greeting."
          >
            <Textarea
              rows={7}
              value={pasted}
              placeholder={"ravi@acme.example\nPriya Menon <priya@beta.example>\narun@gamma.example"}
              onChange={(e) => setPasted(e.target.value)}
            />
          </Field>

          {parsed.people.length || parsed.unreadable.length ? (
            <>
              <div className="row-tight wrap" style={{ margin: "8px 0" }}>
                <Chip tone="accent" solid>{summary.total} addresses read</Chip>
                <Chip tone={summary.usable ? "good" : "bad"}>{summary.usable} usable</Chip>
                {summary.rejected ? <Chip tone="warn">{summary.rejected} rejected</Chip> : null}
                {parsed.duplicates.length ? <Chip tone="neutral">{parsed.duplicates.length} repeated</Chip> : null}
                {alreadyHere ? <Chip tone="neutral">{alreadyHere} already here</Chip> : null}
                {onSuppressionList ? <Chip tone="bad">{onSuppressionList} on the suppression list</Chip> : null}
              </div>

              {/* Disclosed, not slipped in. A first name read from an address
                  is a good guess and occasionally a wrong one, and the person
                  sending is the one who should decide whether that is fine. */}
              {inferredNames || inferredCompanies ? (
                <p className="muted small" style={{ marginTop: 0 }}>
                  Read from the addresses themselves:{" "}
                  {inferredCompanies ? `${inferredCompanies} company name${inferredCompanies === 1 ? "" : "s"} from the domain` : ""}
                  {inferredCompanies && inferredNames ? ", and " : ""}
                  {inferredNames ? `${inferredNames} first name${inferredNames === 1 ? "" : "s"} from the part before the @` : ""}.
                  {" "}Worth a glance in the preview before you launch — “Hello Priya” is right far more
                  often than not, but not always.
                </p>
              ) : null}

              {/* Shared inboxes get no greeting on purpose: "Hello Procurement,"
                  is worse than none. Said here rather than discovered in the
                  exclusion table. */}
              {stillNameless ? (
                <p className="muted small" style={{ marginTop: 0 }}>
                  {stillNameless} could not be given a first name — a shared inbox like
                  procurement@ or an address that is not a name. A template opening “Hello
                  {" {{first_name}}"}” will hold those back unless you tick “send even where a detail
                  is missing” below.
                </p>
              ) : null}

              {parsed.unreadable.length ? (
                <p className="muted small">
                  Could not read: {parsed.unreadable.slice(0, 3).map((u) => `“${u}”`).join(", ")}
                  {parsed.unreadable.length > 3 ? ` and ${parsed.unreadable.length - 3} more` : ""}.
                </p>
              ) : null}

              <Button tone="primary" loading={saving} disabled={!summary.usable} onClick={() => void addPasted()}>
                {summary.usable ? `Add ${summary.usable} to the prospect list` : "Nothing usable yet"}
              </Button>
              <p className="muted small" style={{ marginBottom: 0 }}>
                They are added as prospects first, so the suppression list and the unsubscribe link
                apply to them like anybody else. Nothing is emailed until you launch.
              </p>
            </>
          ) : null}
        </>
      ) : null}

      {mode === "import" ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            For a real export — Apollo, Sales Navigator, a conference list. You will see the column
            mapping and exactly how many rows will be imported before anything is written.
          </p>
          <div className="row-tight wrap">
            <Button tone="primary" onClick={() => setImporting(true)}>Choose a file</Button>
            <SampleDownload compact />
          </div>
          <p className="muted small">
            Not sure what the file should look like? Download the sample, replace the four example
            rows with your own, and upload it back.
          </p>
          <ImportWizard
            open={importing}
            ownerId={ownerId}
            existing={new Set(prospects.map((p) => p.email.toLowerCase()))}
            suppressed={suppressed}
            onClose={() => setImporting(false)}
            onImported={() => onImported([])}
          />
        </>
      ) : null}

      {mode === "choose" ? (
        !prospects.length ? (
          <Empty
            title="Nobody here yet"
            body="Paste a few addresses or upload a list, and they will appear here."
            action={<Button tone="primary" onClick={() => setMode("paste")}>Paste addresses</Button>}
          />
        ) : (
          <>
            <div className="row-tight wrap" style={{ marginBottom: 8 }}>
              <Input
                placeholder="Search email, company or name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Button onClick={() => onSelectedChange(new Set(shown.map((p) => p.id)))}>
                Select these {shown.length}
              </Button>
              {selected.size ? (
                <Button onClick={() => onSelectedChange(new Set())}>Clear — use everyone</Button>
              ) : null}
            </div>

            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              <table className="table compact">
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.id}>
                      <td style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          aria-label={`Write to ${p.email}`}
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                        />
                      </td>
                      <td>
                        <div>{p.fullName || p.firstName || p.email}</div>
                        <div className="muted small">{p.email}{p.company ? ` · ${p.company}` : ""}</div>
                      </td>
                      <td className="num">
                        {suppressed.has(p.email.toLowerCase()) ? <Chip tone="bad">Suppressed</Chip>
                          : p.quarantined ? <Chip tone="warn">Held back</Chip>
                          : !isEligible(p.verificationStatus) ? <Chip tone="warn">{p.verificationStatus}</Chip>
                          : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {prospects.length > shown.length ? (
              <p className="muted small" style={{ marginBottom: 0 }}>
                Showing {shown.length} of {prospects.length}. Narrow the search, or leave nobody ticked
                to write to everyone sendable.
              </p>
            ) : null}
          </>
        )
      ) : null}
    </Card>
  );
}
