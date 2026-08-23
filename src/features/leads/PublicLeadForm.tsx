import { useEffect, useState } from "react";
import { Button, Card, Field, Input, Select, Textarea } from "../../components/primitives";
import { STATE_NAMES } from "../../domain/geo/states";
import { COUNTRIES } from "../../domain/geo/countries";
import { gstinMessage, validateGSTIN } from "../../domain/gstin/validate";

/**
 * The public registration form.
 *
 * Reached at `?lead=<salesperson-id>`, a link any CRM user can share. No
 * sign-in: a customer fills in their own details and they land as a lead in
 * the referring salesperson's pipeline.
 *
 * Everything on this page is written for somebody who has never seen the CRM
 * and is doing us a favour by filling it in. It asks for as little as it can,
 * explains why it wants a GSTIN, and never blames them for a link that a
 * salesperson typed wrongly.
 */

interface Branding {
  valid: boolean;
  repName?: string;
  company?: { name?: string; logo?: string | null; tagline?: string; website?: string };
  accentColor?: string;
}

type Status = "loading" | "invalid" | "ready" | "sending" | "sent";

const BLANK = {
  company: "", contact: "", designation: "", email: "", phone: "",
  country: "India", state: "Delhi", city: "", address: "", pincode: "",
  gstin: "", pan: "", message: "",
  /* The honeypot. Never shown to a person; a value here means a bot. */
  website: "",
};

export function PublicLeadForm({ refId }: { refId: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [branding, setBranding] = useState<Branding | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/.netlify/functions/public-lead-info?ref=" + encodeURIComponent(refId))
      .then((r) => r.json())
      .then((data: Branding) => {
        if (!live) return;
        if (!data.valid) { setStatus("invalid"); return; }
        setBranding(data);
        setStatus("ready");
      })
      .catch(() => { if (live) setStatus("invalid"); });
    return () => { live = false; };
  }, [refId]);

  const set = (key: keyof typeof BLANK) => (e: { target: { value: string } }) =>
    setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const isIndia = form.country === "India";
  const gstinCheck = validateGSTIN(form.gstin);
  const gstinBad = form.gstin.trim().length > 0 && !gstinCheck.valid;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setStatus("sending");
    try {
      const resp = await fetch("/.netlify/functions/submit-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refId, ...form }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) {
        setError(typeof data.error === "string" ? data.error : "Something went wrong. Please try again.");
        setStatus("ready");
        return;
      }
      setStatus("sent");
    } catch {
      setError("Couldn't reach us just now — check your connection and try again.");
      setStatus("ready");
    }
  };

  if (status === "loading") return <Centred>Loading…</Centred>;

  if (status === "invalid") {
    return (
      <Centred>
        <Card title="This link isn't valid">
          <p style={{ margin: 0 }}>
            Please check the link, or ask whoever sent it to you for a fresh one. Nothing you type here would
            reach them until it works.
          </p>
        </Card>
      </Centred>
    );
  }

  if (status === "sent") {
    return (
      <Centred>
        <Card title="Thank you — we have your details">
          <div className="stack">
            <p style={{ margin: 0 }}>
              {branding?.repName ? `${branding.repName} will be in touch shortly.` : "Someone will be in touch shortly."}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              You can close this page. There's nothing else to do.
            </p>
          </div>
        </Card>
      </Centred>
    );
  }

  const company = branding?.company;
  const sending = status === "sending";

  return (
    <main className="public-form">
      <div className="public-panel">
        <header className="public-head">
          {company?.logo ? <img src={company.logo} alt="" className="public-logo" /> : null}
          <div>
            <div className="public-company">{company?.name || "Registration"}</div>
            {company?.tagline ? <div className="muted">{company.tagline}</div> : null}
          </div>
        </header>

        <form onSubmit={(e) => void submit(e)}>
          <Card title="Your details">
            <p className="muted" style={{ marginTop: 0 }}>
              {branding?.repName
                ? `${branding.repName} asked for these so your quotation is right first time.`
                : "So your quotation is right first time."}
              {" "}Anything marked optional can be left blank.
            </p>

            <div className="stack" style={{ marginTop: 14 }}>
              <div className="grid grid-2">
                <Field label="Company or organisation">
                  <Input required value={form.company} onChange={set("company")} />
                </Field>
                <Field label="Your name">
                  <Input required value={form.contact} onChange={set("contact")} />
                </Field>
                <Field label="Your role" hint="Optional.">
                  <Input value={form.designation} onChange={set("designation")} />
                </Field>
                <Field label="Email">
                  <Input type="email" value={form.email} onChange={set("email")} />
                </Field>
                <Field label="Phone">
                  <Input value={form.phone} onChange={set("phone")} placeholder="+91 98100 12345" />
                </Field>
                <Field label="Country">
                  <Select value={form.country} onChange={set("country")}>
                    {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="field-hint">An email or a phone number — either is enough to reach you.</div>

              <div className="grid grid-2">
                <Field label="Address" hint="Optional.">
                  <Textarea rows={2} value={form.address} onChange={set("address")} />
                </Field>
                <div className="stack">
                  <div className="grid grid-2">
                    <Field label="City"><Input value={form.city} onChange={set("city")} /></Field>
                    <Field label={isIndia ? "PIN code" : "Post code"}>
                      <Input value={form.pincode} onChange={set("pincode")} />
                    </Field>
                  </div>
                  {isIndia ? (
                    <Field label="State" hint="Decides how tax is charged, so it's worth getting right.">
                      <Select value={form.state} onChange={set("state")}>
                        {STATE_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                      </Select>
                    </Field>
                  ) : (
                    <Field label="State or region" hint="Optional.">
                      <Input value={form.state} onChange={set("state")} />
                    </Field>
                  )}
                </div>
              </div>

              {isIndia ? (
                <div className="grid grid-2">
                  <Field
                    label="GSTIN"
                    hint="Optional, but with it your invoice carries the tax credit you can claim."
                    error={gstinBad ? gstinMessage(gstinCheck) : undefined}
                  >
                    <Input
                      className="mono"
                      value={form.gstin}
                      invalid={gstinBad}
                      onChange={(e) => setForm((cur) => ({ ...cur, gstin: e.target.value.toUpperCase() }))}
                    />
                  </Field>
                  <Field label="PAN" hint="Optional.">
                    <Input
                      className="mono"
                      value={form.pan}
                      onChange={(e) => setForm((cur) => ({ ...cur, pan: e.target.value.toUpperCase() }))}
                    />
                  </Field>
                </div>
              ) : null}

              <Field label="Anything we should know" hint="Optional — what you're looking for, quantities, timing.">
                <Textarea rows={3} value={form.message} onChange={set("message")} />
              </Field>

              {/* Hidden from people, irresistible to bots. Deliberately not
                  display:none — some bots skip those. */}
              <div className="honeypot" aria-hidden="true">
                <label htmlFor="lead-website">Leave this empty</label>
                <input id="lead-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
              </div>

              {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

              <div className="row-tight">
                <Button
                  type="submit"
                  tone="primary"
                  disabled={sending || !form.company.trim() || !form.contact.trim() || (!form.email.trim() && !form.phone.trim()) || gstinBad}
                >
                  {sending ? "Sending…" : "Send my details"}
                </Button>
              </div>
              <div className="field-hint">
                Used only to prepare your quotation and to get in touch about it.
              </div>
            </div>
          </Card>
        </form>

        {company?.website ? (
          <footer className="public-foot muted">{company.website}</footer>
        ) : null}
      </div>
    </main>
  );
}

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <main className="public-form">
      <div className="public-panel">{children}</div>
    </main>
  );
}
