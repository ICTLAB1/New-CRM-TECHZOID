import { useRef, useState } from "react";
import { Button, Card, Field, Input } from "../../components/primitives";
import { useToast } from "../../components/Toast";
import { Confirm } from "../../components/Modal";
import { STRIP_TITLES, type StripKey } from "../../domain/documents/model";
import {
  DEFAULT_CERTIFICATIONS, DEFAULT_PARTNER_DESIGNATIONS, DEFAULT_TECHNOLOGY_PARTNERS,
} from "../../domain/documents/brandDefaults";

/**
 * The three logo strips that print at the foot of every document.
 *
 * Until now these could only be changed by editing code, which meant a new
 * brand needed a developer and a deploy. A salesperson adding "we also
 * supply Dell" is a normal Tuesday, not a release.
 *
 * ARTWORK IS OPTIONAL AND THAT IS THE POINT. A brand logo is a trademark;
 * an entry with no artwork prints its NAME, which is a true statement about
 * what this company sells. The alternative — drawing an approximation of
 * someone's logo — is not the logo, it is a forgery that happens to be bad.
 * Upload the real file when the vendor supplies it.
 */

/** Well under what a settings row should carry, and far more than a strip
 *  logo needs: these print about 20mm wide. */
const MAX_LOGO_BYTES = 300 * 1024;

interface StripEntry {
  label: string;
  data?: string;
  w?: number;
  h?: number;
  caption?: string;
  certNo?: string;
}

const SETTINGS_KEY: Record<StripKey, string> = {
  designations: "partnerDesignations",
  partners: "brandingLogos",
  certifications: "certLogos",
};

const DEFAULTS: Record<StripKey, readonly StripEntry[]> = {
  designations: DEFAULT_PARTNER_DESIGNATIONS,
  partners: DEFAULT_TECHNOLOGY_PARTNERS,
  certifications: DEFAULT_CERTIFICATIONS,
};

const HELP: Record<StripKey, string> = {
  designations:
    "Accreditations this company holds and is licensed to display. Only add one where the vendor has actually granted it — claiming a partner status you do not hold is a false statement on a document that binds.",
  partners:
    "Brands sold. A name alone prints perfectly well; upload the vendor's own artwork when you have it. Do not caption anything here as a partner unless the vendor granted a partner badge.",
  certifications:
    "Management-system certifications held. The label is what an images-off email shows, so keep the standard and year in it.",
};

export function BrandStripsPanel({
  settings, canEdit, onChange,
}: {
  settings: Record<string, unknown>;
  canEdit: boolean;
  onChange: (next: Record<string, unknown>) => void;
}) {
  return (
    <div className="stack">
      {(Object.keys(STRIP_TITLES) as StripKey[]).map((key) => (
        <StripEditor key={key} stripKey={key} settings={settings} canEdit={canEdit} onChange={onChange} />
      ))}
    </div>
  );
}

function StripEditor({
  stripKey, settings, canEdit, onChange,
}: {
  stripKey: StripKey;
  settings: Record<string, unknown>;
  canEdit: boolean;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const settingsKey = SETTINGS_KEY[stripKey];
  const stored = settings[settingsKey];
  const rows: StripEntry[] = Array.isArray(stored) ? (stored as StripEntry[]) : [...DEFAULTS[stripKey]];

  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const fileFor = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /* Written straight through rather than into a draft: every edit here is
     one field of one row, and a Save button guarding a list you are already
     watching change is friction with nothing behind it. */
  const write = (next: StripEntry[]) => onChange({ ...settings, [settingsKey]: next });

  const setAt = (i: number, patch: Partial<StripEntry>) =>
    write(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const pickArtwork = (file: File | undefined) => {
    const i = fileFor.current;
    fileFor.current = null;
    setError("");
    if (!file || i === null) return;
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) {
      setError("That needs to be a PNG, JPG, SVG or WebP image.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError("Couldn't read that file. Try saving it again and re-picking it.");
    reader.onload = () => {
      const src = String(reader.result ?? "");
      if (src.length > MAX_LOGO_BYTES) {
        setError(
          `That image is about ${Math.round(src.length / 1024)} KB encoded. ` +
          "Around 300 KB is plenty — a strip logo prints at roughly 20mm wide.",
        );
        return;
      }
      /* The natural size is measured once, here, rather than by every
         renderer at draw time — it is what keeps the aspect ratio and it
         decides whether a mark is treated as round or wide. */
      const img = new Image();
      img.onerror = () => setError("That file doesn't look like an image the browser can read.");
      img.onload = () => {
        setAt(i, { data: src, w: img.naturalWidth, h: img.naturalHeight });
        toast("Artwork added. It prints on the next document you open.", "good");
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  return (
    <Card
      title={STRIP_TITLES[stripKey]}
      actions={
        canEdit ? (
          <span className="row-tight">
            <Button size="sm" tone="quiet" onClick={() => setConfirmReset(true)}>Reset</Button>
            <Button size="sm" tone="default" onClick={() => write([...rows, { label: "" }])}>Add</Button>
          </span>
        ) : null
      }
    >
      <p className="field-hint" style={{ marginTop: 0 }}>{HELP[stripKey]}</p>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        hidden
        onChange={(e) => { pickArtwork(e.target.files?.[0]); e.target.value = ""; }}
      />

      {rows.length === 0 ? (
        <p className="field-hint">Nothing here — this strip will not print.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Artwork</th>
                <th>Name</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td data-label="Artwork">
                    {row.data ? (
                      <img
                        src={row.data}
                        alt={row.label || "Logo"}
                        style={{ maxWidth: 70, maxHeight: 34, objectFit: "contain", display: "block" }}
                      />
                    ) : (
                      <span className="field-hint">Name only</span>
                    )}
                  </td>
                  <td data-head>
                    <Field label="" hint={stripKey === "certifications" ? "Include the standard and year." : undefined}>
                      <Input
                        value={row.label ?? ""}
                        disabled={!canEdit}
                        placeholder="Brand or accreditation name"
                        onChange={(e) => setAt(i, { label: e.target.value })}
                      />
                    </Field>
                  </td>
                  <td data-actions>
                    {canEdit ? (
                      <span className="row-tight">
                        <Button
                          size="sm"
                          tone="quiet"
                          onClick={() => { fileFor.current = i; input.current?.click(); }}
                        >
                          {row.data ? "Replace" : "Upload"}
                        </Button>
                        {row.data ? (
                          <Button size="sm" tone="quiet" onClick={() => setAt(i, { data: undefined, w: undefined, h: undefined })}>
                            Remove artwork
                          </Button>
                        ) : null}
                        <Button size="sm" tone="danger" onClick={() => write(rows.filter((_, j) => j !== i))}>
                          Delete
                        </Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error ? <div className="notice notice-bad"><span>{error}</span></div> : null}

      <Confirm
        open={confirmReset}
        title={`Reset ${STRIP_TITLES[stripKey].toLowerCase()}?`}
        body="This puts the strip back to what ships with the product. Anything you added here, and any artwork you uploaded, is lost."
        confirmLabel="Reset"
        tone="danger"
        onConfirm={() => { write([...DEFAULTS[stripKey]]); setConfirmReset(false); toast("Strip reset.", "good"); }}
        onCancel={() => setConfirmReset(false)}
      />
    </Card>
  );
}
