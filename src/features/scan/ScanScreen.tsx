import { useCallback, useEffect, useRef, useState } from "react";
import { PageHead } from "../../app/AppShell";
import { Button, Card, Field, Input } from "../../components/primitives";
import { findByNumber, type SearchHit } from "../../app/GlobalSearch";
import { parseScan } from "../../domain/documents/scanCode";
import type { WorkspaceData } from "../../data/useWorkspace";
import "./scan.css";

/**
 * Point the camera at the square on a printed document and open it.
 *
 * WHY A SCREEN AND NOT A HEADER BUTTON. The header is already seven
 * controls wide and overflowed on a phone once; and a phone is the only
 * device anybody will ever do this on, which is where the header has the
 * least room. A screen also has somewhere to put the two things a camera
 * needs and a button has nowhere for: what to do when permission is
 * refused, and what to do when the code is too creased to read.
 *
 * THE DECODER IS LOADED ON DEMAND. It is 40KB that only a person standing
 * at a filing cabinet needs, so it is not in the bundle everybody else
 * downloads to look at a dashboard.
 *
 * THE CAMERA IS RELEASED on every exit — the stop button, a successful
 * scan, leaving the screen. A tab that holds a camera open shows a
 * recording light on the phone and keeps it warm, and people are right to
 * find that alarming.
 */

type Phase =
  | { at: "idle" }
  | { at: "starting" }
  | { at: "scanning" }
  | { at: "denied"; why: string }
  | { at: "missed"; code: string };

export interface ScanScreenProps {
  data: WorkspaceData;
  onOpen: (hit: SearchHit) => void;
}

export function ScanScreen({ data, onOpen }: ScanScreenProps) {
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [typed, setTyped] = useState("");
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const frame = useRef<number | null>(null);
  /* Read by the frame loop, which outlives a render. */
  const live = useRef(false);

  const stop = useCallback(() => {
    live.current = false;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  /* Leaving the screen, closing the tab, a hot reload — all of them must
     release the camera. */
  useEffect(() => stop, [stop]);

  const resolve = useCallback((text: string): boolean => {
    const number = parseScan(text);
    const hit = number ? findByNumber(data, number) : null;
    if (!hit) {
      setPhase({ at: "missed", code: number || text.slice(0, 40) });
      return false;
    }
    stop();
    onOpen(hit);
    return true;
  }, [data, onOpen, stop]);

  const start = useCallback(async () => {
    setPhase({ at: "starting" });
    let jsQR: typeof import("jsqr").default;
    try {
      jsQR = (await import("jsqr")).default;
    } catch {
      setPhase({ at: "denied", why: "The code reader could not be loaded. Check the connection and try again." });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase({ at: "denied", why: "This browser does not offer a camera to the page. Type the number instead." });
      return;
    }
    try {
      /* The back camera, on anything that has two. */
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }, audio: false,
      });
    } catch (e) {
      const why = (e as Error)?.name === "NotAllowedError"
        ? "The camera was blocked. Allow it for this site in the address bar, or type the number instead."
        : "No camera could be opened. Type the number instead.";
      setPhase({ at: "denied", why });
      return;
    }
    const el = video.current;
    if (!el) { stop(); setPhase({ at: "idle" }); return; }
    el.srcObject = stream.current;
    el.setAttribute("playsinline", "true");
    await el.play().catch(() => undefined);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    live.current = true;
    setPhase({ at: "scanning" });

    const tick = () => {
      if (!live.current) return;
      const v = video.current;
      if (ctx && v && v.readyState === v.HAVE_ENOUGH_DATA) {
        /* Downscale to 640 on the long edge: jsQR reads a 640px frame as
           well as a 1080p one and perhaps ten times faster, which is the
           difference between a smooth preview and a phone that heats up. */
        const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        if (canvas.width > 0 && canvas.height > 0) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (found?.data && resolve(found.data)) return;
        }
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [resolve, stop]);

  const openTyped = () => {
    if (!typed.trim()) return;
    if (resolve(typed)) setTyped("");
  };

  return (
    <main className="page">
      <PageHead
        title="Scan a document"
        sub="Point the camera at the square printed on a quotation, proforma, invoice or purchase order to open it here."
      />

      <Card className="stack">
        <div className="scan-stage">
          {/* Kept mounted: the stream is attached to this element before
              the first frame is asked for, and a node that appears only
              once scanning starts is not there yet when that happens. */}
          <video ref={video} className="scan-video" muted playsInline
            style={{ display: phase.at === "scanning" ? "block" : "none" }} />
          {phase.at === "scanning" ? <div className="scan-reticle" aria-hidden /> : null}
          {phase.at !== "scanning" ? (
            <div className="scan-placeholder">
              {phase.at === "starting" ? "Starting the camera…" : "The camera preview appears here."}
            </div>
          ) : null}
        </div>

        <div className="row wrap" style={{ gap: "var(--gap)" }}>
          {phase.at === "scanning"
            ? <Button tone="default" onClick={() => { stop(); setPhase({ at: "idle" }); }}>Stop the camera</Button>
            : <Button tone="primary" onClick={() => void start()} disabled={phase.at === "starting"}>
                {phase.at === "starting" ? "Starting…" : "Start the camera"}
              </Button>}
        </div>

        {phase.at === "denied" ? <p className="scan-note scan-note-warn">{phase.why}</p> : null}
        {phase.at === "missed" ? (
          <p className="scan-note scan-note-warn">
            Read “{phase.code}”, which is not a document in this workspace. If you are signed in to the
            other company, switch to it and scan again.
          </p>
        ) : null}
      </Card>

      <Card className="stack">
        <Field label="Or type the number printed beside the square">
          <div className="row" style={{ gap: "var(--gap)" }}>
            <Input value={typed} placeholder="TZ/QT/2026-27/0042"
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") openTyped(); }} />
            <Button tone="primary" onClick={openTyped} disabled={!typed.trim()}>Open</Button>
          </div>
        </Field>
        <p className="scan-note">
          The square holds the document number and nothing else — no link, no customer details — so a
          document that leaves the building gives away nothing it was not already printed with.
        </p>
      </Card>
    </main>
  );
}
