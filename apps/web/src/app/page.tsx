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
    time: "Step 1",
  },
  {
    stage: "02",
    title: "Compute what matters",
    detail: "Structure the data, run the math, rank the signals worth presenting.",
    time: "Step 2",
  },
  {
    stage: "03",
    title: "Build the narrative",
    detail: "Shape the story for your audience with every claim traced to source.",
    time: "Step 3",
  },
  {
    stage: "04",
    title: "Deliver both formats",
    detail: "An editable PPTX and a polished PDF from the same analysis.",
    time: "Step 4",
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
              <h1>Two weeks of analysis. Delivered in hours.</h1>
              <p className="hero-subtitle">
                Upload your data. Get back a finished analysis — actionable insights, compelling narrative, and a presentation you&apos;d put your name on.
              </p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Try it with your data
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
          <div className="hero-slide-gallery">
            <div className="hero-slide-card hero-slide-card-back-2">
              <Image
                src="/showcase/slide-showcase-recommendations.svg"
                alt="Strategic recommendations slide with three action levers"
                width={480}
                height={270}
                priority
              />
            </div>
            <div className="hero-slide-card hero-slide-card-back">
              <Image
                src="/showcase/slide-showcase-chart.svg"
                alt="Market structure chart comparing Cat vs Dog segments"
                width={480}
                height={270}
                priority
              />
            </div>
            <div className="hero-slide-card hero-slide-card-front">
              <Image
                src="/showcase/slide-showcase-executive.svg"
                alt="Executive overview slide showing market size and growth metrics"
                width={480}
                height={270}
                priority
              />
            </div>
          </div>

          <div className="hero-output-caption">
            <div className="artifact-evidence-row">
              <span className="artifact-chip">PPTX</span>
              <span className="artifact-chip">PDF</span>
              <span className="artifact-chip subtle">11 slides from real data</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Social proof strip ── */}
      <section className="panel social-proof-panel">
        <div className="social-proof-content">
          <div className="stack">
            <p className="section-label">Background</p>
            <h2>Built by a team with roots in NielsenIQ, Mondelez, and Victorinox.</h2>
          </div>
          <div className="social-proof-stats">
            <div className="stat-block">
              <span className="stat-number">10+</span>
              <span className="stat-label">years in CPG reporting</span>
            </div>
            <div className="stat-block">
              <span className="stat-number">5-15 min</span>
              <span className="stat-label">typical generation time</span>
            </div>
            <div className="stat-block">
              <span className="stat-number">2</span>
              <span className="stat-label">formats per report (PPTX + PDF)</span>
            </div>
          </div>
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
              <div className="pipeline-step-head">
                <p className="artifact-kind">{step.stage}</p>
                <span className="pipeline-time">{step.time}</span>
              </div>
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
          <p className="muted">Every Basquio report ships as an editable PPTX and a polished PDF — same data, same story, same evidence trace.</p>
        </div>

        <div className="output-preview-grid">
          <article className="showcase-card">
            <div className="showcase-card-top">
              <span className="artifact-chip strong">PPTX</span>
              <span className="artifact-window-meta">Editable in PowerPoint</span>
            </div>
            <div className="showcase-feature-list">
              <div className="showcase-feature">
                <strong>Professional charts</strong>
                <p className="muted">High-resolution charts rendered from your data and embedded as locked visuals for consistent display.</p>
              </div>
              <div className="showcase-feature">
                <strong>Speaker notes</strong>
                <p className="muted">Key talking points and evidence references in every slide&apos;s notes field.</p>
              </div>
              <div className="showcase-feature">
                <strong>Brand-matched</strong>
                <p className="muted">Colors, fonts, and logo placement pulled from your template.</p>
              </div>
            </div>
          </article>

          <article className="showcase-card showcase-card-pdf">
            <div className="showcase-card-top">
              <span className="artifact-chip strong">PDF</span>
              <span className="artifact-window-meta">Ready to share</span>
            </div>
            <div className="showcase-feature-list">
              <div className="showcase-feature">
                <strong>Polished layout</strong>
                <p className="muted">Type-set pages optimized for screen sharing and print.</p>
              </div>
              <div className="showcase-feature">
                <strong>Evidence appendix</strong>
                <p className="muted">Source references and data lineage collected at the end.</p>
              </div>
              <div className="showcase-feature">
                <strong>Same story</strong>
                <p className="muted">Identical narrative and numbers — no drift between formats.</p>
              </div>
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
