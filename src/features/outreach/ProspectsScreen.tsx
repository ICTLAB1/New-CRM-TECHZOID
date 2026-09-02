import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Chip, Empty, Input, Select, StatTile, SummaryBar } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { ImportWizard } from "./ImportWizard";
import {
  listProspects, listSuppressions, outreachAvailable, releaseProspect, suppress,
  type ProspectRow,
} from "../../data/outreach";
import { isEligible } from "../../domain/outreach/verify";
import { fmtDate } from "../../domain/dates";
import type { Tone } from "../../components/primitives";

/**
 * The people this company could write to, and what is known about them.
 *
 * A prospect is not a customer. `customers` is an account somebody is dealing
 * with; this is a list of strangers, most of whom will never reply. Keeping
 * them apart is what stops the pipeline filling with names nobody has spoken
 * to — see supabase/022_outreach_prospects.sql.
 *
 * The list is PAGED, not loaded whole: a list built from three conference
 * exports is tens of thousands of rows, and a screen that tries to hold all
 * of them is a screen that stops opening.
 */

const PAGE = 50;

export interface ProspectsScreenProps {
  currentUser: { id: string; name: string; role: string };
  /** So the composer can be opened straight from here. */
  onCompose?: (prospectIds: string[]) => void;
}

const statusTone = (p: ProspectRow): Tone => {
  if (p.quarantined) return "warn";
  if (p.status === "Unsubscribed") return "bad";
  if (p.status === "Replied") return "good";
  if (p.status === "Contacted") return "accent";
  return "neutral";
};

export function ProspectsScreen({ currentUser, onCompose }: ProspectsScreenProps) {
  const toast = useToast();
  const [rows, setRows] = useState<ProspectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [showHeld, setShowHeld] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suppressedSet, setSuppressedSet] = useState<Set<string>>(new Set());

  const available = outreachAvailable();

  const load = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    try {
      const out = await listProspects({
        limit: PAGE,
        offset: page * PAGE,
        search: query,
        status: status === "all" ? undefined : status,
        includeQuarantined: showHeld,
      });
      setRows(out.rows);
      setTotal(out.total);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not load the prospect list.", "bad");
    } finally {
      setLoading(false);
    }
  }, [available, page, query, status, showHeld, toast]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!available) return;
    listSuppressions(10000)
      .then((s) => setSuppressedSet(new Set(s.map((r) => r.email.toLowerCase()))))
      .catch(() => { /* the audit degrades to not knowing; it still imports */ });
  }, [available]);

  /* Counted over the loaded page only, and labelled as such. A tile that
     silently describes 50 of 4,000 rows is worse than no tile. */
  const onPage = useMemo(() => ({
    sendable: rows.filter((r) => !r.quarantined && isEligible(r.verificationStatus)).length,
    held: rows.filter((r) => r.quarantined).length,
    contacted: rows.filter((r) => r.status === "Contacted").length,
  }), [rows]);

  const existingAddresses = useMemo(
    () => new Set(rows.map((r) => r.email.toLowerCase())),
    [rows],
  );

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  async function hold(p: ProspectRow) {
    try {
      await suppress({
        email: p.email,
        reason: "do-not-contact",
        note: `Marked by ${currentUser.name}`,
        addedBy: currentUser.id,
      });
      setSuppressedSet((s) => new Set(s).add(p.email.toLowerCase()));
      toast(`${p.email} will never be written to again.`, "good");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add them to the suppression list.", "bad");
    }
  }

  async function release(p: ProspectRow) {
    try {
      await releaseProspect(p.id);
      toast(`${p.email} released — they can be written to now.`, "good");
      void load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not release that prospect.", "bad");
    }
  }

  if (!available) {
    return (
      <main className="page">
        <PageHead title="Prospects" />
        <Empty
          title="Prospects need the database"
          body="This screen reads and writes live data, so it is unavailable in the preview build."
        />
      </main>
    );
  }

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <main className="page">
      <PageHead
        title="Prospects"
        sub="People this company could write to. Importing adds them to the list — it never emails anybody."
        actions={
          <>
            {selected.size > 0 && onCompose ? (
              <Button tone="primary" onClick={() => onCompose([...selected])}>
                Write to {selected.size} selected
              </Button>
            ) : null}
            <Button onClick={() => setImporting(true)}>Import a list</Button>
          </>
        }
      />

      <SummaryBar columns={4}>
        <StatTile label="Prospects in total" value={String(total)} />
        <StatTile label="Sendable on this page" value={String(onPage.sendable)} meta={`of ${rows.length}`} />
        <StatTile label="Contacted on this page" value={String(onPage.contacted)} tone={undefined} />
        <StatTile label="Held back on this page" value={String(onPage.held)} tone={onPage.held ? "warn" : undefined} />
      </SummaryBar>

      <Card
        title={`${total} prospect${total === 1 ? "" : "s"}`}
        actions={
          <div className="row-tight wrap">
            <Input
              placeholder="Search email, company or name"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            />
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
              <option value="all">Any status</option>
              <option value="New">New</option>
              <option value="Contacted">Contacted</option>
              <option value="Replied">Replied</option>
              <option value="Unsubscribed">Unsubscribed</option>
            </Select>
            <label className="row-tight small">
              <input
                type="checkbox"
                checked={showHeld}
                onChange={(e) => { setShowHeld(e.target.checked); setPage(0); }}
              />
              Show held back
            </label>
          </div>
        }
        padded={false}
      >
        {loading && !rows.length ? (
          <p className="muted" style={{ padding: 16 }}>Loading…</p>
        ) : !rows.length ? (
          <Empty
            title={query || status !== "all" ? "Nothing matches" : "No prospects yet"}
            body={
              query || status !== "all"
                ? "Try a wider search."
                : "Import a CSV to get started. Nothing is emailed by importing."
            }
            action={<Button tone="primary" onClick={() => setImporting(true)}>Import a list</Button>}
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    aria-label="Select every prospect on this page"
                    checked={allOnPageSelected}
                    onChange={(e) =>
                      setSelected((s) => {
                        const next = new Set(s);
                        for (const r of rows) {
                          if (e.target.checked) next.add(r.id); else next.delete(r.id);
                        }
                        return next;
                      })
                    }
                  />
                </th>
                <th>Person</th>
                <th>Company</th>
                <th>Address</th>
                <th>Status</th>
                <th>Last written to</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const stopped = suppressedSet.has(p.email.toLowerCase());
                return (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.email}`}
                        checked={selected.has(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                    </td>
                    <td>
                      <div>{p.fullName || p.firstName || "—"}</div>
                      {p.jobTitle ? <div className="muted small">{p.jobTitle}</div> : null}
                    </td>
                    <td>{p.company || "—"}</td>
                    <td>
                      <div>{p.email}</div>
                      {!isEligible(p.verificationStatus) ? (
                        <div className="muted small">{p.verificationStatus} — {p.verificationReason}</div>
                      ) : null}
                    </td>
                    <td>
                      <div className="row-tight wrap">
                        <Chip tone={statusTone(p)}>{p.quarantined ? "Held back" : p.status}</Chip>
                        {stopped ? <Chip tone="bad">Suppressed</Chip> : null}
                      </div>
                      {p.quarantined && p.quarantineReason ? (
                        <div className="muted small">{p.quarantineReason}</div>
                      ) : null}
                    </td>
                    <td>{p.lastContactedAt ? fmtDate(p.lastContactedAt.slice(0, 10)) : "—"}</td>
                    <td className="num">
                      <div className="row-tight">
                        {p.quarantined ? (
                          <Button tone="quiet" onClick={() => void release(p)}>Release</Button>
                        ) : null}
                        {!stopped ? (
                          <Button tone="quiet" onClick={() => void hold(p)}>Never contact</Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {pages > 1 ? (
        <div className="row-tight" style={{ justifyContent: "center", marginTop: 12 }}>
          <Button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</Button>
          <span className="muted small">Page {page + 1} of {pages}</span>
          <Button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      ) : null}

      <ImportWizard
        open={importing}
        ownerId={currentUser.id}
        existing={existingAddresses}
        suppressed={suppressedSet}
        onClose={() => setImporting(false)}
        onImported={() => { setPage(0); void load(); }}
      />
    </main>
  );
}
