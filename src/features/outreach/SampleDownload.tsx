import { Button } from "../../components/primitives";
import { ALL_COLUMN_LABELS, SAMPLE_FILE_NAME, sampleCsv } from "../../domain/outreach/sampleCsv";

/**
 * "What columns does it want?" — answered with a file rather than a sentence.
 *
 * The importer guesses column names from a wide list of spellings, so this is
 * not strictly needed. It is here because it is the first question anybody
 * asks at an empty import screen, and a file they can open in Excel and type
 * into beats a paragraph they have to transcribe.
 *
 * Built and downloaded in the browser: no request, no round trip, and it
 * works before anything has been configured.
 */

export function SampleDownload({ compact = false }: { compact?: boolean }) {
  function download() {
    const blob = new Blob([sampleCsv()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = SAMPLE_FILE_NAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* Freed on the next tick rather than immediately: revoking it in the same
       frame as the click cancels the download in some browsers. */
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <>
      <Button tone={compact ? "quiet" : "default"} onClick={download}>
        Download a sample file
      </Button>
      {!compact ? (
        <p className="muted small" style={{ marginBottom: 0 }}>
          Only the email column is required — the rest are optional, and your own file can use its
          own headings. The importer also recognises: {ALL_COLUMN_LABELS.join(", ")}.
        </p>
      ) : null}
    </>
  );
}
