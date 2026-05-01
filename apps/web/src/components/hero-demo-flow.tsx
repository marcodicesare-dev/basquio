"use client";

import { useEffect, useRef, useState } from "react";

/**
 * HeroDemoFlow · the self-explanatory product demo for the hero.
 *
 * Three boxes in a row demonstrate the full workflow without a single CTA
 * button: drop your files, drop your template, download the analysis.
 * A scripted cursor animation walks through the boxes so a first-time
 * visitor with zero context understands what Basquio does in ~10 seconds:
 *
 *   t = 0       three pale boxes, brief copy below
 *   t = 0.8s    cursor fades in, glides to the Files box
 *   t = 1.6s    cursor "drops" file pills (3 files appear with stagger)
 *   t = 2.6s    cursor glides to the Template box
 *   t = 3.4s    cursor drops template pill
 *   t = 4.4s    spinner appears between Template and Download
 *   t = 5.6s    Download box "lights up" (pale azzurro -> solid blue)
 *               three artifact pills (deck, report, workbook) appear
 *   t = 7.0s    cursor glides to Download box
 *   t = 7.7s    cursor click animation, button compresses
 *   t = 8.5s    state holds (loop cooldown 9s before sequence restarts)
 *
 * Mirrors the language Rossella used in her voice note: "i pulsanti di
 * file, template e download sono di un colore pallido. Quando il download
 * e' pronto, si accende. La pagina tiene in memoria input, template e
 * brief cosi' puoi riscaricare."
 *
 * Honors prefers-reduced-motion: skips cursor + spinner, shows the final
 * "ready to download" state immediately.
 */

type Stage =
  | "idle"
  | "cursor-to-files"
  | "files-dropped"
  | "cursor-to-template"
  | "template-dropped"
  | "processing"
  | "download-ready"
  | "cursor-to-download"
  | "download-clicked";

const FILE_PILLS = [
  { label: "espresso-q4-share.xlsx", tone: "blue" as const },
  { label: "modern-trade-promo.csv", tone: "blue" as const },
  { label: "stakeholder-notes.md", tone: "blue" as const },
];

const TEMPLATE_PILL = { label: "northstar-coffee-jbp-v3.pptx", tone: "amber" as const };

const OUTPUT_PILLS = [
  { label: "deck.pptx", tone: "blue" as const },
  { label: "narrative_report.md", tone: "amber" as const },
  { label: "data_tables.xlsx", tone: "green" as const },
];

const DEMO_LOOP_MS = 14000;

export function HeroDemoFlow() {
  const rootRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const downloadRef = useRef<HTMLDivElement>(null);

  const [isInView, setIsInView] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [loopTick, setLoopTick] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const reducedMotion = usePrefersReducedMotion();

  // Visibility trigger
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let triggered = false;
    const fire = () => {
      if (triggered) return;
      triggered = true;
      setIsInView(true);
    };
    const check = () => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.95 && r.bottom > 0) fire();
    };
    if (typeof IntersectionObserver !== "undefined") {
      const obs = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && fire()),
        { threshold: 0.05, rootMargin: "0px 0px -5% 0px" },
      );
      obs.observe(el);
      window.addEventListener("scroll", check, { passive: true });
      check();
      return () => {
        window.removeEventListener("scroll", check);
        obs.disconnect();
      };
    }
  }, []);

  // Sequence runner — re-runs every loopTick increment
  useEffect(() => {
    if (!isInView) return;
    if (reducedMotion) {
      setStage("download-ready");
      return;
    }
    setStage("idle");
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => setStage("cursor-to-files"), 800),
      window.setTimeout(() => setStage("files-dropped"), 1600),
      window.setTimeout(() => setStage("cursor-to-template"), 2600),
      window.setTimeout(() => setStage("template-dropped"), 3400),
      window.setTimeout(() => setStage("processing"), 4400),
      window.setTimeout(() => setStage("download-ready"), 5600),
      window.setTimeout(() => setStage("cursor-to-download"), 7000),
      window.setTimeout(() => setStage("download-clicked"), 7700),
      // Loop after 14 seconds
      window.setTimeout(() => setLoopTick((t) => t + 1), DEMO_LOOP_MS),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [isInView, reducedMotion, loopTick]);

  // Cursor target ref based on stage
  useEffect(() => {
    if (!rootRef.current) return;
    const root = rootRef.current.getBoundingClientRect();
    const targetEl =
      stage === "cursor-to-files" || stage === "files-dropped"
        ? filesRef.current
        : stage === "cursor-to-template" || stage === "template-dropped"
          ? templateRef.current
          : stage === "cursor-to-download" || stage === "download-clicked"
            ? downloadRef.current
            : null;
    if (!targetEl) return;
    const t = targetEl.getBoundingClientRect();
    setCursorPos({
      x: t.left - root.left + t.width * 0.5 - 6,
      y: t.top - root.top + t.height * 0.55 - 6,
    });
  }, [stage]);

  const cursorVisible = stage !== "idle" && !reducedMotion;
  const filesActive = stageReached(stage, "files-dropped");
  const templateActive = stageReached(stage, "template-dropped");
  const processing = stage === "processing";
  const downloadReady = stageReached(stage, "download-ready");
  const downloadClicked = stage === "download-clicked";

  return (
    <div ref={rootRef} className="hero-demo" aria-label="How Basquio works in three steps">
      {cursorVisible && (
        <span
          className="hero-demo-cursor"
          aria-hidden="true"
          style={{ transform: `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0)` }}
        >
          <CursorIcon />
        </span>
      )}

      <div className="hero-demo-row">
        <DemoBox
          boxRef={filesRef}
          step="01"
          title="Drop your files"
          subtitle="CSV, Excel, PDF, notes"
          state={filesActive ? "filled" : "pale"}
          icon={<UploadIcon />}
          pills={filesActive ? FILE_PILLS : []}
        />

        <Connector active={templateActive || processing || downloadReady} />

        <DemoBox
          boxRef={templateRef}
          step="02"
          title="Drop your template"
          subtitle="PPTX brand template"
          state={templateActive ? "filled" : "pale"}
          icon={<TemplateIcon />}
          pills={templateActive ? [TEMPLATE_PILL] : []}
        />

        <Connector active={downloadReady} processing={processing} />

        <DemoBox
          boxRef={downloadRef}
          step="03"
          title="Download your analysis"
          subtitle="PPTX, report, workbook"
          state={
            downloadClicked
              ? "pressed"
              : downloadReady
                ? "ready"
                : processing
                  ? "loading"
                  : "pale"
          }
          icon={<DownloadIcon />}
          pills={downloadReady ? OUTPUT_PILLS : []}
          accent
        />
      </div>

      <p className="hero-demo-brief">
        <span className="hero-demo-brief-tick" aria-hidden="true" />
        Brief in plain language. Basquio reads everything together and writes the analysis your
        stakeholder asked for.
      </p>
    </div>
  );
}

type DemoBoxProps = {
  step: string;
  title: string;
  subtitle: string;
  state: "pale" | "filled" | "loading" | "ready" | "pressed";
  icon: React.ReactNode;
  pills: { label: string; tone: "blue" | "amber" | "green" }[];
  accent?: boolean;
  boxRef: React.RefObject<HTMLDivElement | null>;
};

function DemoBox({ step, title, subtitle, state, icon, pills, accent = false, boxRef }: DemoBoxProps) {
  return (
    <div
      ref={boxRef}
      className={`hero-demo-box hero-demo-box-${state}${accent ? " hero-demo-box-accent" : ""}`}
    >
      <div className="hero-demo-box-head">
        <span className="hero-demo-box-step">{step}</span>
        <span className="hero-demo-box-icon">{icon}</span>
      </div>
      <div className="hero-demo-box-text">
        <p className="hero-demo-box-title">{title}</p>
        <p className="hero-demo-box-subtitle">{subtitle}</p>
      </div>
      {state === "loading" && <div className="hero-demo-box-spinner" aria-hidden="true" />}
      {pills.length > 0 && (
        <ul className="hero-demo-box-pills" aria-live="polite">
          {pills.map((p, i) => (
            <li
              key={p.label}
              className={`hero-demo-box-pill hero-demo-box-pill-${p.tone}`}
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="hero-demo-box-pill-glyph" aria-hidden="true" />
              {p.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Connector({ active, processing = false }: { active: boolean; processing?: boolean }) {
  return (
    <span
      className={`hero-demo-connector${active ? " hero-demo-connector-active" : ""}${
        processing ? " hero-demo-connector-processing" : ""
      }`}
      aria-hidden="true"
    >
      <span className="hero-demo-connector-line" />
      <span className="hero-demo-connector-arrow">→</span>
    </span>
  );
}

function CursorIcon() {
  return (
    <svg width="22" height="24" viewBox="0 0 22 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 1.5L20 11L11.5 13L8 21.5L2 1.5Z"
        fill="#0B0C0C"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 3v11M6 8l5-5 5 5M3 16v3h16v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="4" width="16" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <line x1="3" y1="9" x2="19" y2="9" stroke="currentColor" strokeWidth="1.5" />
      <line x1="9" y1="9" x2="9" y2="18" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 3v12M6 10l5 5 5-5M3 18v1h16v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function stageReached(current: Stage, target: Stage) {
  const order: Stage[] = [
    "idle",
    "cursor-to-files",
    "files-dropped",
    "cursor-to-template",
    "template-dropped",
    "processing",
    "download-ready",
    "cursor-to-download",
    "download-clicked",
  ];
  return order.indexOf(current) >= order.indexOf(target);
}

function usePrefersReducedMotion() {
  const [prefers, setPrefers] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefers(mql.matches);
    const onChange = () => setPrefers(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return prefers;
}
