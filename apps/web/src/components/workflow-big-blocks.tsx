"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Three-column horizontal workflow section. Each column is a large card
 * (file drop, template drop, download lights up), with a sequential cursor
 * driven animation that walks left to right and then loops.
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
  { name: "espresso-q4-share.xlsx", glyph: "xlsx" },
  { name: "modern-trade-promo.csv", glyph: "csv" },
  { name: "stakeholder-notes.md", glyph: "md" },
  { name: "northstar-prior-deck.pptx", glyph: "pptx" },
];

const TEMPLATE_PILL = {
  name: "northstar-coffee-jbp-v3.pptx",
  glyph: "pptx",
} as const;

const OUTPUT_PILLS = [
  { name: "deck.pptx", tone: "blue" as const },
  { name: "narrative_report.md", tone: "amber" as const },
  { name: "data_tables.xlsx", tone: "green" as const },
];

const DEMO_LOOP_MS = 14000;

export function WorkflowBigBlocks() {
  const rootRef = useRef<HTMLDivElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const templateRef = useRef<HTMLDivElement>(null);
  const downloadRef = useRef<HTMLDivElement>(null);

  const [isInView, setIsInView] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [loopTick, setLoopTick] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const reducedMotion = usePrefersReducedMotion();

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
      if (r.top < window.innerHeight * 0.92 && r.bottom > 0) fire();
    };
    if (typeof IntersectionObserver !== "undefined") {
      const obs = new IntersectionObserver(
        (entries) => entries.forEach((e) => e.isIntersecting && fire()),
        { threshold: 0.1, rootMargin: "0px 0px -8% 0px" },
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
      window.setTimeout(() => setStage("files-dropped"), 1700),
      window.setTimeout(() => setStage("cursor-to-template"), 3400),
      window.setTimeout(() => setStage("template-dropped"), 4300),
      window.setTimeout(() => setStage("processing"), 5400),
      window.setTimeout(() => setStage("download-ready"), 6800),
      window.setTimeout(() => setStage("cursor-to-download"), 8600),
      window.setTimeout(() => setStage("download-clicked"), 9400),
      window.setTimeout(() => setLoopTick((t) => t + 1), DEMO_LOOP_MS),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [isInView, reducedMotion, loopTick]);

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
      y: t.top - root.top + 80,
    });
  }, [stage]);

  const cursorVisible = stage !== "idle" && !reducedMotion;
  const filesActive = reached(stage, "files-dropped");
  const templateActive = reached(stage, "template-dropped");
  const processing = stage === "processing";
  const downloadReady = reached(stage, "download-ready");
  const downloadClicked = stage === "download-clicked";

  return (
    <section className="workflow-big" aria-labelledby="workflow-big-heading">
      <header className="workflow-big-head">
        <p className="section-j-eyebrow">Come funziona</p>
        <h2 id="workflow-big-heading" className="section-j-title">
          Due settimane di analisi. Consegnate in poche ore.
        </h2>
        <p className="section-j-body">
          Carica gli input, carica un template, scarica l&apos;analisi. Basquio si occupa della
          produzione nel mezzo, così resti sul lavoro di analisi, non sul montaggio delle slide.
        </p>
      </header>

      <div ref={rootRef} className="workflow-big-stage">
        {cursorVisible && (
          <span
            className="workflow-big-cursor"
            aria-hidden="true"
            style={{ transform: `translate3d(${cursorPos.x}px, ${cursorPos.y}px, 0)` }}
          >
            <CursorIcon />
          </span>
        )}

        <Step
          boxRef={filesRef}
          number="01"
          eyebrow="Carica i file"
          title="Brief, dati, appunti."
          body="CSV, Excel, PDF, trascrizioni. Tutto quello che l'analista ha già sul disco."
          state={filesActive ? "filled" : "pale"}
        >
          <FilesTray active={filesActive} />
        </Step>

        <Connector active={templateActive || processing || downloadReady} />

        <Step
          boxRef={templateRef}
          number="02"
          eyebrow="Carica il template"
          title="Il template di brand, o lo standard Basquio."
          body="Cover, divisori, pagine finali e font approvati vanno direttamente nel risultato."
          state={templateActive ? "filled" : "pale"}
        >
          <TemplateFrame active={templateActive} />
        </Step>

        <Connector active={downloadReady} processing={processing} />

        <Step
          boxRef={downloadRef}
          number="03"
          eyebrow="Scarica l'analisi"
          title="Presentazione, report, workbook."
          body="Tre file. I numeri tornano fra tutti. Modificabili, citati alla fonte, pronti per la riunione."
          state={
            downloadClicked
              ? "pressed"
              : downloadReady
                ? "ready"
                : processing
                  ? "loading"
                  : "pale"
          }
          accent
        >
          <DownloadTile
            state={
              downloadClicked
                ? "pressed"
                : downloadReady
                  ? "ready"
                  : processing
                    ? "loading"
                    : "pale"
            }
          />
        </Step>
      </div>
    </section>
  );
}

type StepProps = {
  boxRef: React.RefObject<HTMLDivElement | null>;
  number: string;
  eyebrow: string;
  title: string;
  body: string;
  state: "pale" | "filled" | "loading" | "ready" | "pressed";
  accent?: boolean;
  children: React.ReactNode;
};

function Step({ boxRef, number, eyebrow, title, body, state, accent, children }: StepProps) {
  return (
    <article
      ref={boxRef}
      className={`workflow-big-step workflow-big-step-${state}${accent ? " workflow-big-step-accent" : ""}`}
    >
      <div className="workflow-big-step-head">
        <span className="workflow-big-step-number">{number}</span>
        <span className="workflow-big-step-eyebrow">{eyebrow}</span>
      </div>
      <div className="workflow-big-step-stage">{children}</div>
      <div className="workflow-big-step-text">
        <h3 className="workflow-big-step-title">{title}</h3>
        <p className="workflow-big-step-body">{body}</p>
      </div>
    </article>
  );
}

function Connector({ active, processing = false }: { active: boolean; processing?: boolean }) {
  return (
    <span
      className={`workflow-big-connector${active ? " workflow-big-connector-active" : ""}${
        processing ? " workflow-big-connector-processing" : ""
      }`}
      aria-hidden="true"
    >
      <svg
        className="workflow-big-connector-svg"
        viewBox="0 0 80 12"
        preserveAspectRatio="none"
        fill="none"
      >
        <line
          className="workflow-big-connector-track"
          x1="0"
          y1="6"
          x2="80"
          y2="6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          className="workflow-big-connector-flow"
          x1="0"
          y1="6"
          x2="80"
          y2="6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      <svg
        className="workflow-big-connector-head"
        viewBox="0 0 14 14"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M3 3l5 4-5 4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function FilesTray({ active }: { active: boolean }) {
  return (
    <div className={`workflow-big-files${active ? " workflow-big-files-active" : ""}`}>
      <p className="workflow-big-files-label">Workspace inputs</p>
      <ul className="workflow-big-files-list">
        {FILE_PILLS.map((p, i) => (
          <li
            key={p.name}
            className={`workflow-big-file workflow-big-file-${p.glyph}`}
            style={{ animationDelay: `${i * 140}ms` }}
          >
            <span className="workflow-big-file-glyph">{p.glyph}</span>
            <span className="workflow-big-file-name">{p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TemplateFrame({ active }: { active: boolean }) {
  return (
    <div className={`workflow-big-template${active ? " workflow-big-template-active" : ""}`}>
      <div className="workflow-big-template-frame">
        <div className="workflow-big-template-frame-meta">
          <span className="workflow-big-template-mark" aria-hidden="true" />
          <span className="workflow-big-template-name">{TEMPLATE_PILL.name}</span>
        </div>
        <div className="workflow-big-template-frame-body">
          <span className="workflow-big-template-bar" />
          <span className="workflow-big-template-bar workflow-big-template-bar-short" />
          <div className="workflow-big-template-grid">
            <span />
            <span />
            <span />
            <span className="workflow-big-template-grid-tall" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DownloadTile({ state }: { state: "pale" | "filled" | "loading" | "ready" | "pressed" }) {
  return (
    <div className={`workflow-big-download workflow-big-download-${state}`}>
      <div className="workflow-big-download-tile">
        {state === "loading" ? (
          <span className="workflow-big-download-spinner" aria-hidden="true" />
        ) : state === "ready" || state === "pressed" ? (
          <span className="workflow-big-download-check" aria-hidden="true">
            ✓
          </span>
        ) : (
          <span className="workflow-big-download-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path
                d="M11 3v12M6 10l5 5 5-5M3 18v1h16v-1"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}
        <p className="workflow-big-download-label">
          {state === "loading"
            ? "Sto preparando i file"
            : state === "ready" || state === "pressed"
              ? "Scarica la tua analisi"
              : "In attesa degli input"}
        </p>
      </div>

      <ul className="workflow-big-download-pills">
        {OUTPUT_PILLS.map((p, i) => (
          <li
            key={p.name}
            className={`workflow-big-download-pill workflow-big-download-pill-${p.tone}${
              state === "ready" || state === "pressed" ? " workflow-big-download-pill-ready" : ""
            }`}
            style={{ transitionDelay: `${i * 90}ms` }}
          >
            <span className="workflow-big-download-pill-glyph" aria-hidden="true" />
            {p.name}
          </li>
        ))}
      </ul>
    </div>
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

function reached(current: Stage, target: Stage) {
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
