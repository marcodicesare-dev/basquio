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
              <div className="deck-chart deck-chart-bars">
                <span style={{ height: "36%" }} />
                <span style={{ height: "48%" }} />
                <span style={{ height: "70%" }} />
                <span className="accent" style={{ height: "88%" }} />
              </div>
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
              <div className="deck-chart deck-chart-area" />
              <div className="deck-line medium" />
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
                  <div className="proof-evidence-visual">
                    <div className="proof-bars">
                      <span style={{ height: "32%" }} />
                      <span style={{ height: "54%" }} />
                      <span className="accent" style={{ height: "76%" }} />
                    </div>
                    <div className="proof-tag">Source trail</div>
                  </div>
                ) : null}

                {point.kind === "brand" ? (
                  <div className="proof-brand-visual">
                    <span className="brand-swatch neutral" />
                    <span className="brand-arrow">to</span>
                    <span className="brand-swatch accent" />
                  </div>
                ) : null}

                {point.kind === "system" ? (
                  <div className="proof-system-visual">
                    <span>Story</span>
                    <span>Math</span>
                  </div>
                ) : null}
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
