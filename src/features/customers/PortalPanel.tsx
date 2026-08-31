import { useCallback, useEffect, useState } from "react";
import { Button, Chip, Field, Input, Select } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import {
  issuePortalLink, listPortalLinks, portalLinksAvailable, revokePortalLink,
} from "../../data/portalLinks";
import { linkState, PORTAL_DURATIONS, type PortalTokenRow } from "../../domain/portal/token";

/**
 * The link that lets a customer see their own quotations.
 *
 * WHAT THE PERSON USING THIS NEEDS TO UNDERSTAND, and what the panel is
 * written to make unavoidable: the link IS the password. Anyone who has it
 * sees this customer's documents. That is what makes it useful — a purchase
 * manager will not create an account to look at a quotation — and it is why
 * the panel shows an expiry on every link, a revoke button beside it, and the
 * secret exactly once.
 *
 * Once, and not by choice: the database holds only a hash. There is no
 * "show me that link again", because there is nothing to show.
 */

const when = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

export interface PortalPanelProps {
  customerId: string;
  /** Blank while a customer is being created. A link cannot be issued
   *  against a record that has no id yet, and saying so is better than a
   *  button that fails. */
  saved: boolean;
  currentUserId: string;
}

export function PortalPanel({ customerId, saved, currentUserId }: PortalPanelProps) {
  const toast = useToast();
  const [links, setLinks] = useState<PortalTokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  /* The one that was just minted. Held in state rather than in the list,
     because the list comes from the database and the database does not have
     it — nor should it. */
  const [fresh, setFresh] = useState("");

  const available = portalLinksAvailable();

  const reload = useCallback(async () => {
    if (!available || !saved) return;
    setLoading(true);
    try {
      setLinks(await listPortalLinks(customerId));
    } catch {
      /* Quiet. A customer sheet that will not open because a secondary panel
         could not list its links is a worse outcome than a panel that is
         briefly empty; the issue button reports its own failures loudly. */
    } finally {
      setLoading(false);
    }
  }, [available, saved, customerId]);

  useEffect(() => { void reload(); }, [reload]);

  const issue = async () => {
    setIssuing(true);
    try {
      const issued = await issuePortalLink({
        customerId, createdBy: currentUserId, label, days,
      });
      setFresh(issued.url);
      setLabel("");
      setLinks((cur) => [issued.row, ...cur]);
      /* Straight onto the clipboard, because the next thing they will do is
         paste it, and this is the only moment it exists. Best-effort: a
         browser that refuses gets the text on screen to copy by hand. */
      try { await navigator.clipboard.writeText(issued.url); toast("Link copied. It's shown once — paste it now.", "good"); }
      catch { toast("Link created. Copy it now — it isn't shown again.", "warn"); }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't create the link.", "bad");
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async (row: PortalTokenRow) => {
    try {
      await revokePortalLink(row.id);
      setLinks((cur) => cur.map((l) => (l.id === row.id ? { ...l, revokedAt: new Date().toISOString() } : l)));
      toast("Link withdrawn. It stops working immediately.", "good");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't withdraw the link.", "bad");
    }
  };

  return (
    <div className="stack" style={{ borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Customer portal</strong>
        {loading ? <span className="field-hint">Loading…</span> : null}
      </div>

      {!available ? (
        /* Shown rather than hidden, the same way the verification panel is:
           a control that silently is not there reads as a feature that was
           never built, and somebody looking for it goes and asks. */
        <p className="field-hint" style={{ margin: 0 }}>
          Portal links need the live database. This preview hasn't got one.
        </p>
      ) : !saved ? (
        <p className="field-hint" style={{ margin: 0 }}>
          Save this customer first, then you can send them a link to their documents.
        </p>
      ) : (
        <>
          <p className="field-hint" style={{ margin: 0 }}>
            A page where {"they"} can see the quotations, proformas and invoices we've sent
            them, and accept or decline a quotation. No password — the link itself is
            the key, so it expires, and you can withdraw it.
          </p>

          {fresh ? (
            <div className="stack" style={{ background: "var(--good-weak)", padding: 12, borderRadius: 8 }}>
              <strong>Copy this now — it isn't shown again.</strong>
              <Input readOnly value={fresh} onFocus={(e) => e.currentTarget.select()} />
              <div className="row">
                <Button
                  onClick={() => {
                    void navigator.clipboard.writeText(fresh)
                      .then(() => toast("Copied.", "good"))
                      .catch(() => toast("Select the text and copy it.", "warn"));
                  }}
                >
                  Copy again
                </Button>
                <Button onClick={() => setFresh("")}>Done</Button>
              </div>
            </div>
          ) : null}

          <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Who is it for?" hint="Optional — so you know which to withdraw later.">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ravi in purchasing" />
            </Field>
            <Field label="Expires after">
              <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
                {PORTAL_DURATIONS.map((d) => (
                  <option key={d} value={d}>{d === 365 ? "A year" : `${d} days`}</option>
                ))}
              </Select>
            </Field>
            <Button tone="primary" loading={issuing} loadingLabel="Creating…" onClick={() => void issue()}>
              Create a link
            </Button>
          </div>

          {links.length > 0 ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>For</th>
                    <th>Expires</th>
                    <th>Opened</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {links.map((row) => {
                    const state = linkState(row);
                    return (
                      <tr key={row.id}>
                        <td>
                          <div>{row.label || "Not labelled"}</div>
                          <div className="field-hint">Created {when(row.createdAt)}</div>
                        </td>
                        <td>
                          <Chip tone={state === "live" ? "good" : "neutral"}>
                            {state === "revoked" ? "Withdrawn" : state === "expired" ? "Expired" : when(row.expiresAt)}
                          </Chip>
                        </td>
                        <td>
                          {/* Whether they ever looked is the useful part. A
                              quotation nobody opened and a quotation read four
                              times are different conversations to have. */}
                          {row.viewCount > 0
                            ? <span>{row.viewCount === 1 ? "Once" : `${row.viewCount} times`}, last {when(row.lastSeenAt)}</span>
                            : <span className="field-hint">Not yet</span>}
                        </td>
                        <td>
                          {state === "live"
                            ? <Button size="sm" tone="danger" onClick={() => void revoke(row)}>Withdraw</Button>
                            : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
