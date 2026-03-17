import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import {
  gettingStartedSteps,
  heroSignals,
  personas,
  proofPoints,
} from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio | Evidence In. Executive Deck Out.",
  description:
    "Upload the files behind one reporting cycle. Basquio turns your CSVs, notes, briefs, and brand files into an executive-ready PPTX and PDF.",
};

function OutputPptxChart() {
  return (
    <div className="chart-frame">
      <div className="chart-meta-row">
        <span>Value share by channel</span>
        <span>MAT Q1 2026</span>
      </div>
      <svg className="viz-svg" viewBox="0 0 520 250" aria-hidden>
        <defs>
          <linearGradient id="pptxBarAccent" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f0cc27" />
            <stop offset="100%" stopColor="#f4ad1c" />
          </linearGradient>
        </defs>
        <g stroke="rgba(11,12,12,0.08)" strokeWidth="1">
          <line x1="56" y1="28" x2="56" y2="198" />
          <line x1="56" y1="198" x2="486" y2="198" />
          <line x1="56" y1="158" x2="486" y2="158" />
          <line x1="56" y1="118" x2="486" y2="118" />
          <line x1="56" y1="78" x2="486" y2="78" />
        </g>
        {/* Category benchmark bars */}
        <g fill="#7688bf" opacity="0.3">
          <rect x="76" y="142" width="32" height="56" rx="8" />
          <rect x="166" y="126" width="32" height="72" rx="8" />
          <rect x="256" y="134" width="32" height="64" rx="8" />
          <rect x="346" y="118" width="32" height="80" rx="8" />
          <rect x="436" y="148" width="32" height="50" rx="8" />
        </g>
        {/* Premium segment bars */}
        <g fill="url(#pptxBarAccent)">
          <rect x="112" y="118" width="32" height="80" rx="8" />
          <rect x="202" y="86" width="32" height="112" rx="8" />
          <rect x="292" y="72" width="32" height="126" rx="8" />
          <rect x="382" y="56" width="32" height="142" rx="8" />
          <rect x="472" y="98" width="32" height="100" rx="8" />
        </g>
        <g fill="#0b0c0c" fontSize="11">
          <text x="78" y="218">Grocery</text>
          <text x="168" y="218">Drug</text>
          <text x="255" y="218">Club</text>
          <text x="348" y="218">Mass</text>
          <text x="440" y="218">eComm</text>
        </g>
        <g fill="#5d656b" fontSize="11">
          <text x="20" y="201">0%</text>
          <text x="14" y="161">10%</text>
          <text x="14" y="121">20%</text>
          <text x="14" y="81">30%</text>
        </g>
        <g>
          <rect x="296" y="18" width="176" height="34" rx="17" fill="rgba(11,12,12,0.06)" />
          <text x="312" y="40" fill="#0b0c0c" fontSize="13" fontWeight="700">
            Premium +3.2x in Mass
          </text>
        </g>
      </svg>
      <div className="chart-legend">
        <span>
          <i className="legend-swatch legend-swatch-muted" />
          Total category
        </span>
        <span>
          <i className="legend-swatch legend-swatch-accent" />
          Premium segment
        </span>
      </div>
    </div>
  );
}

function OutputPdfChart() {
  return (
    <div className="chart-frame chart-frame-pdf">
      <div className="chart-meta-row">
        <span>Distribution-weighted velocity</span>
        <span>L52W, tracked channels</span>
      </div>
      <svg className="viz-svg" viewBox="0 0 520 250" aria-hidden>
        <defs>
          <linearGradient id="pdfAreaFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(26,106,255,0.3)" />
            <stop offset="100%" stopColor="rgba(26,106,255,0.05)" />
          </linearGradient>
        </defs>
        <g stroke="rgba(11,12,12,0.08)" strokeWidth="1">
          <line x1="54" y1="30" x2="54" y2="200" />
          <line x1="54" y1="200" x2="490" y2="200" />
          <line x1="54" y1="150" x2="490" y2="150" />
          <line x1="54" y1="100" x2="490" y2="100" />
          <line x1="54" y1="50" x2="490" y2="50" />
        </g>
        {/* Category trend line (flat/declining) */}
        <path
          d="M54 142 L126 146 L198 152 L270 148 L342 156 L414 160 L486 164"
          fill="none"
          stroke="#7688bf"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.4"
        />
        {/* Premium segment trend line (accelerating) */}
        <path
          d="M54 168 L126 154 L198 148 L270 112 L342 94 L414 68 L486 46"
          fill="none"
          stroke="#1a6aff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M54 168 L126 154 L198 148 L270 112 L342 94 L414 68 L486 46 L486 200 L54 200 Z"
          fill="url(#pdfAreaFill)"
        />
        <circle cx="486" cy="46" r="6" fill="#ffffff" stroke="#1a6aff" strokeWidth="4" />
        <rect x="362" y="24" width="130" height="38" rx="19" fill="rgba(240,204,39,0.18)" />
        <text x="378" y="48" fill="#0b0c0c" fontSize="13" fontWeight="700">
          Share inflects Q3
        </text>
        <g fill="#0b0c0c" fontSize="12">
          <text x="40" y="220">P1</text>
          <text x="112" y="220">P2</text>
          <text x="184" y="220">P3</text>
          <text x="258" y="220">P4</text>
          <text x="330" y="220">P5</text>
          <text x="402" y="220">P6</text>
          <text x="474" y="220">P7</text>
        </g>
      </svg>
    </div>
  );
}

function EvidenceTraceVisual() {
  return (
    <div className="chart-frame chart-frame-tight">
      <svg className="viz-svg" viewBox="0 0 420 160" aria-hidden>
        <g stroke="rgba(11,12,12,0.08)" strokeWidth="1">
          <line x1="40" y1="20" x2="40" y2="128" />
          <line x1="40" y1="128" x2="380" y2="128" />
          <line x1="40" y1="92" x2="380" y2="92" />
          <line x1="40" y1="56" x2="380" y2="56" />
        </g>
        <path
          d="M40 112 L108 96 L176 104 L244 72 L312 46 L380 30"
          fill="none"
          stroke="#9cb4f5"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="312" cy="46" r="7" fill="#f0cc27" stroke="#ffffff" strokeWidth="4" />
        <path d="M312 46 L336 24" stroke="#0b0c0c" strokeWidth="2" strokeLinecap="round" />
        <rect x="266" y="8" width="118" height="28" rx="14" fill="rgba(26,106,255,0.08)" />
        <text x="282" y="26" fill="#1a6aff" fontSize="13" fontWeight="700">
          Evidence ref 03
        </text>
      </svg>
      <div className="chart-legend chart-legend-compact">
        <span>
          <i className="legend-swatch legend-swatch-accent" />
          Claim linked to source
        </span>
      </div>
    </div>
  );
}

function BrandControlVisual() {
  return (
    <div className="brand-compare">
      <div className="brand-mini-slide">
        <span className="brand-mini-label">Generic</span>
        <svg className="brand-mini-svg" viewBox="0 0 170 108" aria-hidden>
          <rect x="20" y="46" width="26" height="40" rx="8" fill="#d8d9df" />
          <rect x="56" y="34" width="26" height="52" rx="8" fill="#d8d9df" />
          <rect x="92" y="24" width="26" height="62" rx="8" fill="#d8d9df" />
          <rect x="128" y="16" width="26" height="70" rx="8" fill="#d8d9df" />
          <line x1="16" y1="86" x2="156" y2="86" stroke="rgba(11,12,12,0.08)" />
        </svg>
      </div>
      <div className="brand-arrow-wrap">to</div>
      <div className="brand-mini-slide brand-mini-slide-accent">
        <span className="brand-mini-label">Branded</span>
        <svg className="brand-mini-svg" viewBox="0 0 170 108" aria-hidden>
          <rect x="20" y="46" width="26" height="40" rx="8" fill="#c8d6fb" />
          <rect x="56" y="34" width="26" height="52" rx="8" fill="#c8d6fb" />
          <rect x="92" y="24" width="26" height="62" rx="8" fill="#1a6aff" />
          <rect x="128" y="16" width="26" height="70" rx="8" fill="#f0cc27" />
          <line x1="16" y1="86" x2="156" y2="86" stroke="rgba(11,12,12,0.08)" />
        </svg>
      </div>
    </div>
  );
}

function StoryMathVisual() {
  return (
    <div className="story-math-flow">
      <div className="story-math-node">Data</div>
      <div className="story-math-split">
        <div className="story-math-branch">
          <span className="story-math-node">Math</span>
          <small>Deterministic</small>
        </div>
        <div className="story-math-branch">
          <span className="story-math-node">Story</span>
          <small>Narrative</small>
        </div>
      </div>
      <div className="story-math-node accent">Deck</div>
    </div>
  );
}

const homepagePipeline = [
  {
    stage: "01",
    title: "Upload one evidence package",
    detail: "CSVs, spreadsheets, briefs, and brand files from one reporting cycle.",
  },
  {
    stage: "02",
    title: "Compute what matters",
    detail: "Structure the data, run the math, rank the signals worth presenting.",
  },
  {
    stage: "03",
    title: "Build the narrative",
    detail: "Shape the story for your audience with every claim traced to source.",
  },
  {
    stage: "04",
    title: "Deliver both formats",
    detail: "An editable PPTX and a polished PDF from the same analysis.",
  },
];

export default function HomePage() {
  return (
    <div className="landing-shell">
      <PublicSiteNav />

      {/* ── Hero ── */}
      <section className="hero-stage marketing-hero">
        <div className="hero-main">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label light">Beautiful Intelligence.</p>
              <h1>Turn one reporting package into a review-ready deck.</h1>
              <p className="hero-subtitle">
                Upload the CSVs, PDFs, notes, and brand files behind one review. Basquio returns an editable PPTX and
                a polished PDF.
              </p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Try with your data
              </Link>
              <Link className="button secondary inverted" href="#output">
                See sample output
              </Link>
            </div>

            <div className="hero-proof-strip" aria-label="Product strengths">
              {heroSignals.map((signal) => (
                <span key={signal} className="hero-proof-pill">
                  {signal}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="hero-artifact-stack">
          <article className="artifact-window hero-artifact-window">
            <div className="artifact-window-top">
              <span className="artifact-window-pill">Sample report</span>
              <span className="artifact-window-meta">Category performance review</span>
            </div>

            <div className="hero-slide-preview">
              <div className="slide-header">
                <p className="artifact-kind">Slide 04</p>
                <Image src="/brand/svg/icon/basquio-icon-amber.svg" alt="" width={24} height={18} aria-hidden />
              </div>

              <div className="stack">
                <h2>Premium segment outperforms by 3.2x in tracked channels.</h2>
                <p className="slide-note">
                  Value share gains accelerate in mass and club while total category growth decelerates to +1.4% MAT.
                </p>
              </div>

              <div className="hero-chart" aria-hidden>
                <div className="hero-chart-bars">
                  <span style={{ height: "36%" }} />
                  <span style={{ height: "52%" }} />
                  <span style={{ height: "68%" }} />
                  <span className="accent" style={{ height: "92%" }} />
                </div>
                <div className="hero-chart-callout">
                  <strong>+4.7 pts</strong>
                  <span>value share, L52W</span>
                </div>
              </div>

              <div className="artifact-evidence-row">
                <span className="artifact-chip">PPTX</span>
                <span className="artifact-chip">PDF</span>
                <span className="artifact-chip subtle">Evidence linked</span>
              </div>
            </div>
          </article>

          <div className="hero-output-caption">
            <p className="artifact-kind">Deliverables</p>
            <p>One analysis. Two deliverables.</p>
          </div>
        </div>
      </section>

      {/* ── Social proof strip ── */}
      <section className="panel social-proof-panel">
        <div className="stack">
          <p className="section-label">Team</p>
          <h2>Built by a team from NielsenIQ, Mondelez, and Victorinox.</h2>
          <p className="muted">
            Founder-led rollout. Private workspaces. Evaluated one real reporting cycle at a time.
          </p>
        </div>
      </section>

      {/* ── Pipeline (4 steps) ── */}
      <section className="technical-panel stack-xl" id="pipeline">
        <div className="row split">
          <div className="stack">
            <p className="section-label light">How it works</p>
            <h2>From evidence package to executive deck in four steps.</h2>
          </div>
          <Link className="button secondary inverted" href="/how-it-works">
            See the full pipeline
          </Link>
        </div>

        <div className="pipeline-strip" role="list">
          {homepagePipeline.map((step) => (
            <article key={step.stage} className="pipeline-step-card" role="listitem">
              <p className="artifact-kind">{step.stage}</p>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Output showcase ── */}
      <section className="panel output-showcase" id="output">
        <div className="stack">
          <p className="section-label">The output</p>
          <h2>One analysis. Two deliverables.</h2>
        </div>

        <div className="output-preview-grid">
          <article className="showcase-card">
            <div className="showcase-card-top">
              <span className="artifact-chip strong">PPTX</span>
              <span className="artifact-window-meta">Editable charts and notes</span>
            </div>

            <div className="deck-slide deck-slide-editable" aria-hidden>
              <div className="deck-kicker">Executive summary</div>
              <div className="deck-line long" />
              <div className="deck-line medium" />
              <OutputPptxChart />
            </div>
          </article>

          <article className="showcase-card showcase-card-pdf">
            <div className="showcase-card-top">
              <span className="artifact-chip strong">PDF</span>
              <span className="artifact-window-meta">Polished shareable output</span>
            </div>

            <div className="deck-slide deck-slide-pdf" aria-hidden>
              <div className="deck-kicker">Share-ready page</div>
              <div className="pdf-summary-card">
                <div className="deck-line long" />
                <div className="deck-line short" />
              </div>
              <OutputPdfChart />
            </div>
          </article>
        </div>
      </section>

      {/* ── Proof points ── */}
      <section className="proof-section">
        <div className="stack">
          <p className="section-label">Proof points</p>
          <h2>Why the output feels review-ready.</h2>
        </div>

        <div className="proof-grid">
          {proofPoints.map((point) => (
            <article key={point.title} className={`panel proof-card proof-card-${point.kind}`}>
              <div className="proof-visual" aria-hidden>
                {point.kind === "evidence" ? <EvidenceTraceVisual /> : null}
                {point.kind === "brand" ? <BrandControlVisual /> : null}
                {point.kind === "system" ? <StoryMathVisual /> : null}
              </div>

              <div className="stack">
                <p className="artifact-kind">{point.label}</p>
                <h3>{point.title}</h3>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── Personas ── */}
      <section className="panel persona-panel">
        <div className="stack">
          <p className="section-label">Who it&apos;s for</p>
          <h2>Choose the reporting workflow that matches your team.</h2>
        </div>

        <div className="persona-grid">
          {personas.map((persona) => (
            <Link key={persona.slug} className="persona-card" href={`/for/${persona.slug}`}>
              <span className="artifact-kind">{persona.title}</span>
              <span>{persona.summary}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Getting started ── */}
      <section className="cards">
        <article className="technical-panel stack-lg">
          <div className="stack">
            <p className="section-label light">Getting started</p>
            <h2>Start with one live review, not a long setup project.</h2>
          </div>

          <div className="stack">
            {gettingStartedSteps.map((step, index) => (
              <div key={step.title} className="stage-row">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div className="stack-xs">
                  <strong>{step.title}</strong>
                  <p className="muted">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="row">
            <Link className="button secondary inverted" href="/get-started">
              Read the setup guide
            </Link>
          </div>
        </article>
      </section>

      <PublicSiteFooterCta />
      <PublicSiteFooter />
    </div>
  );
}
