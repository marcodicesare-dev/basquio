import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import {
  heroSignals,
  landingComparisonRows,
  personas,
  pipelineSteps,
  proofPoints,
  trustSignals,
} from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio | Evidence In. Executive Deck Out.",
  description:
    "Upload data, a report brief, and a design target. Basquio turns evidence packages into executive-ready PPTX and PDF deliverables.",
};

function OutputPptxChart() {
  return (
    <div className="chart-frame">
      <div className="chart-meta-row">
        <span>Market share by channel</span>
        <span>Q1 2026</span>
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
        <g fill="#7688bf" opacity="0.3">
          <rect x="86" y="122" width="36" height="76" rx="10" />
          <rect x="166" y="110" width="36" height="88" rx="10" />
          <rect x="246" y="92" width="36" height="106" rx="10" />
          <rect x="326" y="98" width="36" height="100" rx="10" />
        </g>
        <g fill="url(#pptxBarAccent)">
          <rect x="126" y="102" width="36" height="96" rx="10" />
          <rect x="206" y="82" width="36" height="116" rx="10" />
          <rect x="286" y="52" width="36" height="146" rx="10" />
          <rect x="366" y="68" width="36" height="130" rx="10" />
        </g>
        <g fill="#0b0c0c" fontSize="12">
          <text x="92" y="220">Retail</text>
          <text x="171" y="220">DTC</text>
          <text x="246" y="220">Search</text>
          <text x="327" y="220">Social</text>
        </g>
        <g fill="#5d656b" fontSize="11">
          <text x="20" y="201">0</text>
          <text x="12" y="161">10</text>
          <text x="12" y="121">20</text>
          <text x="12" y="81">30</text>
        </g>
        <g>
          <rect x="278" y="18" width="158" height="34" rx="17" fill="rgba(11,12,12,0.06)" />
          <text x="294" y="40" fill="#0b0c0c" fontSize="14" fontWeight="700">
            Brand X +18 pts
          </text>
        </g>
      </svg>
      <div className="chart-legend">
        <span>
          <i className="legend-swatch legend-swatch-muted" />
          Category
        </span>
        <span>
          <i className="legend-swatch legend-swatch-accent" />
          Brand X
        </span>
      </div>
    </div>
  );
}

function OutputPdfChart() {
  return (
    <div className="chart-frame chart-frame-pdf">
      <div className="chart-meta-row">
        <span>Growth trajectory</span>
        <span>Indexed, Jan to Jun</span>
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
        <path
          d="M54 184 L126 168 L198 174 L270 108 L342 126 L414 92 L486 54 L486 200 L54 200 Z"
          fill="url(#pdfAreaFill)"
        />
        <path
          d="M54 184 L126 168 L198 174 L270 108 L342 126 L414 92 L486 54"
          fill="none"
          stroke="#1a6aff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="414" cy="92" r="6" fill="#ffffff" stroke="#1a6aff" strokeWidth="4" />
        <rect x="344" y="28" width="118" height="38" rx="19" fill="rgba(240,204,39,0.18)" />
        <text x="360" y="52" fill="#0b0c0c" fontSize="14" fontWeight="700">
          Share inflects
        </text>
        <g fill="#0b0c0c" fontSize="12">
          <text x="52" y="220">Jan</text>
          <text x="122" y="220">Feb</text>
          <text x="193" y="220">Mar</text>
          <text x="266" y="220">Apr</text>
          <text x="338" y="220">May</text>
          <text x="410" y="220">Jun</text>
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

export default function HomePage() {
  return (
    <div className="landing-shell">
      <PublicSiteNav />

      <section className="hero-stage marketing-hero">
        <div className="hero-main">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label light">Beautiful Intelligence.</p>
              <h1>Two weeks of analysis. Delivered in hours.</h1>
              <p className="hero-subtitle">Upload data. Get an executive-ready presentation.</p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Try with your data
              </Link>
              <Link className="button secondary inverted" href="#output">
                See examples
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
              <span className="artifact-window-meta">Executive category growth review</span>
            </div>

            <div className="hero-slide-preview">
              <div className="slide-header">
                <p className="artifact-kind">Slide 04</p>
                <Image src="/brand/svg/icon/basquio-icon-amber.svg" alt="" width={24} height={18} aria-hidden />
              </div>

              <div className="stack">
                <h2>Brand X is growing 3.2x faster than category.</h2>
                <p className="slide-note">Share gains accelerate in premium retail while the category softens overall.</p>
              </div>

              <div className="hero-chart" aria-hidden>
                <div className="hero-chart-bars">
                  <span style={{ height: "42%" }} />
                  <span style={{ height: "58%" }} />
                  <span style={{ height: "64%" }} />
                  <span className="accent" style={{ height: "88%" }} />
                </div>
                <div className="hero-chart-callout">
                  <strong>+18 pts</strong>
                  <span>vs. category trend</span>
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

      <section className="panel trust-panel">
        <div className="stack">
          <p className="section-label">Workflow fit</p>
          <h2>Built for teams that already have to defend the story.</h2>
        </div>

        <div className="logo-strip" aria-label="Trusted workflow types">
          {trustSignals.map((signal) => (
            <span key={signal} className="logo-chip">
              {signal}
            </span>
          ))}
        </div>
      </section>

      <section className="technical-panel stack-xl" id="pipeline">
        <div className="row split">
          <div className="stack">
            <p className="section-label light">The pipeline</p>
            <h2>From evidence package to executive deck in one visible flow.</h2>
          </div>
          <Link className="button secondary inverted" href="/how-it-works">
            See the full pipeline
          </Link>
        </div>

        <div className="pipeline-strip" role="list">
          {pipelineSteps.map((step) => (
            <article key={step.stage} className="pipeline-step-card" role="listitem">
              <p className="artifact-kind">{step.stage}</p>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

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

      <section className="proof-section">
        <div className="stack">
          <p className="section-label">Proof points</p>
          <h2>Why the output feels review-ready.</h2>
        </div>

        <div className="proof-grid">
          {proofPoints.map((point) => (
            <article key={point.title} className={`panel proof-card proof-card-${point.kind}`}>
              <div className="proof-visual" aria-hidden>
                {point.kind === "evidence" ? (
                  <EvidenceTraceVisual />
                ) : null}

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

      <section className="panel comparison-panel">
        <div className="stack">
          <p className="section-label">Comparison</p>
          <h2>Analysis first. Slides second.</h2>
        </div>

        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">Generic AI</th>
                <th scope="col">Slide generators</th>
                <th scope="col">Basquio</th>
              </tr>
            </thead>
            <tbody>
              {landingComparisonRows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.genericAi}</td>
                  <td>{row.slideGenerators}</td>
                  <td className="comparison-positive">{row.basquio}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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

      <section className="panel social-proof-panel">
        <div className="stack">
          <p className="section-label">Proof layer</p>
          <h2>The workflow is built around teams that have to defend the story.</h2>
        </div>

        <div className="proof-quote">
          <p>Traceable numbers. Brand-safe output. A presentation the team can actually revise and send.</p>
          <footer>Current on-site proof is workflow-based. Named customer logos and attributed testimonials should ship only when they are real.</footer>
        </div>
      </section>

      <PublicSiteFooterCta />
    </div>
  );
}
