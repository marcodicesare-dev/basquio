import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { heroSignals } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio | Beautiful Intelligence.",
  description:
    "Upload your data and get back a finished analysis, with a real story, traceable numbers, and matching PPTX and PDF output.",
};

const trustStats = [
  { value: "10+ years", label: "in NielsenIQ-grade reporting" },
  { value: "PPTX + PDF", label: "from the same run" },
  { value: "5-15 min", label: "for a finished first draft" },
] as const;

const workflowSteps = [
  {
    stage: "01",
    title: "Bring one real package",
    detail: "Upload the files behind one review, including spreadsheets, notes, and a template if you have one.",
  },
  {
    stage: "02",
    title: "Basquio runs the math",
    detail: "The numbers are computed before the writing starts, so the draft has something solid to stand on.",
  },
  {
    stage: "03",
    title: "The story gets shaped for the room",
    detail: "Audience, objective, and thesis steer the draft so the deck reads like it belongs in the meeting.",
  },
  {
    stage: "04",
    title: "You get both files back",
    detail: "Edit the PPTX, share the PDF, and keep the same story in both formats.",
  },
] as const;

const outputBullets = [
  {
    title: "Real category structure",
    copy: "The first draft starts with a point of view on the market, not a blank chart placeholder.",
  },
  {
    title: "Traceable claims",
    copy: "The numbers stay grounded in the source files, so the team can defend the slide in the room.",
  },
  {
    title: "Your template when you need it",
    copy: "Upload a saved brand system or PPTX and Basquio carries it through the output.",
  },
] as const;

const pricingSnapshot = [
  {
    name: "Individual",
    price: "$10",
    unit: "per standard report",
    copy: "Start with one report at a time. Your first standard report is free.",
    highlight: false,
  },
  {
    name: "Team",
    price: "$149",
    unit: "per month + usage",
    copy: "Shared history, shared templates, and a workspace the whole team can use.",
    highlight: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "annual contract",
    copy: "Governance, SSO, retention controls, and support for larger rollouts.",
    highlight: false,
  },
] as const;

export default function HomePage() {
  return (
    <div className="landing-shell landing-shell-editorial">
      <PublicSiteNav />

      <section className="hero-stage marketing-hero marketing-hero-editorial">
        <div className="hero-main">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label light">Beautiful Intelligence.</p>
              <h1>Two weeks of analysis. Delivered in hours.</h1>
              <p className="hero-subtitle">
                Upload your data. Get back a finished analysis. Basquio does the hard part of the deck so your team can edit, review, and send.
              </p>
            </div>

            <div className="row">
              <Link className="button" href="/jobs/new">
                Try it with your data
              </Link>
              <Link className="button secondary inverted" href="/pricing">
                See pricing
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

        <div className="hero-artifact-column">
          <div className="hero-artifact-frame">
            <Image
              src="/showcase/slide-chart@2x.png"
              alt="Basquio market structure slide with a category bar chart based on Affinity pet care data"
              width={960}
              height={540}
              priority
            />
          </div>

          <div className="hero-artifact-meta">
            <div className="artifact-evidence-row">
              <span className="artifact-chip">Actual Basquio output</span>
              <span className="artifact-chip">Affinity pet care review</span>
              <span className="artifact-chip subtle">PPTX + PDF</span>
            </div>
            <p>Real FMCG numbers, one clean slide, and a point of view you can build on.</p>
          </div>
        </div>
      </section>

      <section className="trust-strip">
        <div className="stack">
          <p className="section-label">Trust</p>
          <h2>Built by people who know how category reviews get made.</h2>
          <p className="muted">
            Basquio comes from the world of NielsenIQ decks, client reviews, and recurring reporting cycles. It is built for teams that need a real first draft, not a toy.
          </p>
        </div>

        <div className="trust-strip-grid">
          {trustStats.map((stat) => (
            <div key={stat.label} className="trust-stat">
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="technical-panel home-flow-panel" id="pipeline">
        <div className="stack">
          <p className="section-label light">How it works</p>
          <h2>From evidence package to finished report in one loop.</h2>
        </div>

        <div className="home-flow-grid">
          {workflowSteps.map((step) => (
            <article key={step.stage} className="home-flow-card">
              <span className="home-flow-index">{step.stage}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-output-proof" id="output">
        <div className="home-output-visual">
          <Image
            src="/showcase/slide-executive@2x.png"
            alt="Basquio executive overview slide showing market, cat, dog, and Affinity performance"
            width={960}
            height={540}
          />
          <div className="artifact-evidence-row">
            <span className="artifact-chip strong">Executive overview</span>
            <span className="artifact-chip">€2.23B market</span>
            <span className="artifact-chip">Affinity +2.6%</span>
          </div>
        </div>

        <div className="stack-xl">
          <div className="stack">
            <p className="section-label">The output</p>
            <h2>One analysis. Two deliverables. Ready for review.</h2>
            <p className="muted">
              The draft comes back as a finished deck, not a pile of bullets. Your team can open the PPTX, send the PDF, and keep working from the same story.
            </p>
          </div>

          <div className="output-bullet-list">
            {outputBullets.map((bullet) => (
              <article key={bullet.title} className="output-bullet">
                <h3>{bullet.title}</h3>
                <p>{bullet.copy}</p>
              </article>
            ))}
          </div>

          <div className="row">
            <Link className="button" href="/jobs/new">
              Start a real report
            </Link>
          </div>
        </div>
      </section>

      <section className="pricing-snapshot-section" id="pricing">
        <div className="pricing-snapshot-head">
          <div className="stack">
            <p className="section-label">Pricing</p>
            <h2>Start free. Pick the buying model that fits the team.</h2>
          </div>
          <Link className="button secondary" href="/pricing">
            See full pricing
          </Link>
        </div>

        <div className="pricing-snapshot-grid">
          {pricingSnapshot.map((tier) => (
            <article
              key={tier.name}
              className={tier.highlight ? "mini-tier-card pricing-card-highlighted" : "mini-tier-card"}
            >
              <p className="mini-tier-name">{tier.name}</p>
              <p className="mini-tier-price">{tier.price}</p>
              <p className="pricing-snapshot-unit">{tier.unit}</p>
              <p className="muted">{tier.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Put one live review through Basquio."
        copy="Start with the files behind a real meeting. If the first draft is strong enough to edit, the workflow is doing its job."
        primaryLabel="Try it with your data"
        primaryHref="/jobs/new"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
