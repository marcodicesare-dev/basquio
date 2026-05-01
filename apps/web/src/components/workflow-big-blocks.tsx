"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Three large animated blocks placed after the hero. Each block is the size
 * of an old-school "section in a deck": full bleed, large copy on the left,
 * an animated illustration of the corresponding action on the right.
 *
 *   01  Drop your files       , files drop into a tray
 *   02  Pick your template    , a PPTX template snaps into place
 *   03  Download the analysis , a download tile lights up with three pills
 *
 * Per the May 2026 review: "I'm imagining it's not a page, it's a beautiful
 * image. That's the viewport. You go down and you have three blocks animated.
 * They're rectangles, but they're almost the whole page. To animate an action
 * is better than to animate a writing."
 *
 * The animations restart whenever a block re-enters the viewport, so a user
 * scrolling back up gets the moment of motion they remember the first time.
 */

type BlockId = "drop" | "template" | "download";

type BlockSpec = {
  id: BlockId;
  number: string;
  eyebrow: string;
  title: string;
  body: string;
  caption: string;
};

const BLOCKS: BlockSpec[] = [
  {
    id: "drop",
    number: "01",
    eyebrow: "Carica i file",
    title: "Carica brief, dati, appunti, vecchi deck.",
    body: "CSV, Excel, PDF, trascrizioni. Tutto quello che l'analista ha già sul disco.",
    caption: "I file entrano nel workspace. Numeri, fogli e named range vengono letti da Basquio in pochi secondi.",
  },
  {
    id: "template",
    number: "02",
    eyebrow: "Carica il template",
    title: "Scegli il tuo template di brand, o usa lo standard Basquio.",
    body: "Template PPTX con cover, divisori, pagine finali e font approvati che vanno direttamente nel risultato.",
    caption: "Basquio legge il profilo del template. Colori, font, griglia delle slide e testo della cover restano fermi.",
  },
  {
    id: "download",
    number: "03",
    eyebrow: "Scarica l'analisi",
    title: "Scarica presentazione, report e workbook.",
    body: "Tre file. I numeri tornano fra tutti. Tutto è modificabile, tutto cita la riga della fonte.",
    caption: "Presentazione, report e tabelle dati. Gli stakeholder navigano, tu resti seduto al posto dell'analista.",
  },
];

export function WorkflowBigBlocks() {
  return (
    <section className="workflow-big" aria-labelledby="workflow-big-heading">
      <header className="workflow-big-head">
        <p className="section-j-eyebrow">Come funziona</p>
        <h2 id="workflow-big-heading" className="section-j-title">
          Tre passi. Lo stesso gesto ogni volta.
        </h2>
        <p className="section-j-body">
          Carica gli input, carica un template, scarica l&apos;analisi. Basquio si occupa della
          produzione nel mezzo, così resti sul lavoro di analisi, non sul montaggio delle slide.
        </p>
      </header>

      <div className="workflow-big-list">
        {BLOCKS.map((block) => (
          <BigBlock key={block.id} block={block} />
        ))}
      </div>
    </section>
  );
}

function BigBlock({ block }: { block: BlockSpec }) {
  const ref = useRef<HTMLElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [restartTick, setRestartTick] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsInView(true);
            setRestartTick((t) => t + 1);
          } else {
            setIsInView(false);
          }
        }
      },
      { threshold: 0.3, rootMargin: "0px 0px -10% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <article
      ref={ref}
      className={`workflow-big-block workflow-big-block-${block.id}${
        isInView ? " workflow-big-block-active" : ""
      }`}
      data-restart={restartTick}
    >
      <div className="workflow-big-block-text">
        <span className="workflow-big-block-number" aria-hidden="true">
          {block.number}
        </span>
        <p className="workflow-big-block-eyebrow">{block.eyebrow}</p>
        <h3 className="workflow-big-block-title">{block.title}</h3>
        <p className="workflow-big-block-body">{block.body}</p>
        <p className="workflow-big-block-caption">{block.caption}</p>
      </div>

      <div className="workflow-big-block-stage" aria-hidden="true">
        {block.id === "drop" && <DropFilesStage active={isInView} tick={restartTick} />}
        {block.id === "template" && (
          <DropTemplateStage active={isInView} tick={restartTick} />
        )}
        {block.id === "download" && (
          <DownloadStage active={isInView} tick={restartTick} />
        )}
      </div>
    </article>
  );
}

const FILE_PILLS = [
  { name: "espresso-q4-share.xlsx", glyph: "xlsx" },
  { name: "modern-trade-promo.csv", glyph: "csv" },
  { name: "stakeholder-notes.md", glyph: "md" },
  { name: "northstar-prior-deck.pptx", glyph: "pptx" },
];

function DropFilesStage({ active, tick }: { active: boolean; tick: number }) {
  return (
    <div
      key={tick}
      className={`drop-stage${active ? " drop-stage-active" : ""}`}
      aria-hidden="true"
    >
      <div className="drop-stage-tray">
        <p className="drop-stage-tray-label">Workspace inputs</p>
        <ul className="drop-stage-tray-list">
          {FILE_PILLS.map((p, i) => (
            <li
              key={p.name}
              className={`drop-stage-pill drop-stage-pill-${p.glyph}`}
              style={{ animationDelay: `${i * 220}ms` }}
            >
              <span className="drop-stage-pill-glyph">{p.glyph}</span>
              <span className="drop-stage-pill-name">{p.name}</span>
            </li>
          ))}
        </ul>
        <span className="drop-stage-cursor" aria-hidden="true">
          <CursorSvg />
        </span>
      </div>
    </div>
  );
}

function DropTemplateStage({ active, tick }: { active: boolean; tick: number }) {
  return (
    <div
      key={tick}
      className={`template-stage${active ? " template-stage-active" : ""}`}
      aria-hidden="true"
    >
      <div className="template-stage-frame">
        <div className="template-stage-frame-meta">
          <span className="template-stage-frame-mark" />
          <span className="template-stage-frame-name">northstar-coffee-jbp-v3.pptx</span>
          <span className="template-stage-frame-page">cover · 1 of 12</span>
        </div>
        <div className="template-stage-frame-body">
          <span className="template-stage-frame-title">
            <span className="template-stage-frame-title-bar" />
            <span className="template-stage-frame-title-bar template-stage-frame-title-bar-short" />
          </span>
          <div className="template-stage-frame-grid">
            <span className="template-stage-frame-block" />
            <span className="template-stage-frame-block" />
            <span className="template-stage-frame-block" />
            <span className="template-stage-frame-block template-stage-frame-block-tall" />
          </div>
          <span className="template-stage-frame-foot">brand · spring 26 · v3</span>
        </div>
      </div>
      <ul className="template-stage-tags">
        <li>Brand fonts</li>
        <li>Cover slide</li>
        <li>Section dividers</li>
        <li>End pages</li>
      </ul>
    </div>
  );
}

function DownloadStage({ active, tick }: { active: boolean; tick: number }) {
  return (
    <div
      key={tick}
      className={`download-stage${active ? " download-stage-active" : ""}`}
      aria-hidden="true"
    >
      <div className="download-stage-tile">
        <div className="download-stage-tile-spinner-wrap">
          <span className="download-stage-tile-spinner" />
          <span className="download-stage-tile-check" aria-hidden="true">
            ✓
          </span>
        </div>
        <p className="download-stage-tile-label">Download your analysis</p>
        <p className="download-stage-tile-sub">deck.pptx · narrative_report.md · data_tables.xlsx</p>
      </div>

      <ul className="download-stage-pills">
        <li className="download-stage-pill download-stage-pill-blue">
          <span className="download-stage-pill-glyph" />
          deck.pptx
        </li>
        <li className="download-stage-pill download-stage-pill-amber">
          <span className="download-stage-pill-glyph" />
          narrative_report.md
        </li>
        <li className="download-stage-pill download-stage-pill-green">
          <span className="download-stage-pill-glyph" />
          data_tables.xlsx
        </li>
      </ul>
    </div>
  );
}

function CursorSvg() {
  return (
    <svg width="24" height="26" viewBox="0 0 22 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
