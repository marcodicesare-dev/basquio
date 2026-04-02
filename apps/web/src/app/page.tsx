import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";
import { SlideShowcase } from "@/components/slide-showcase";

export const metadata: Metadata = {
  title: "Basquio — Turn Data into Finished Analysis Decks | AI Data-to-Presentation Tool",
  description:
    "Upload CSV, Excel, or spreadsheet data and get back a finished analysis deck with real charts, a narrative report, and editable PPTX output. The only AI tool that analyzes data AND builds the presentation.",
  alternates: { canonical: "https://basquio.com" },
  openGraph: {
    title: "Basquio — Turn Data into Finished Analysis Decks",
    description:
      "Upload CSV, Excel, or spreadsheet data and get back a finished analysis deck with real charts, a narrative report, and editable PPTX output.",
  },
};

const problemCards = [
  {
    title: "Manual chart-building",
    copy: "Every chart copied from a spreadsheet. Every axis label fixed by hand.",
  },
  {
    title: "Formatting over analysis",
    copy: "More time aligning boxes than interpreting what the numbers mean.",
  },
  {
    title: "A first draft nobody trusts",
    copy: "The deck goes out with a caveat. The team presents something unfinished.",
  },
] as const;

const workflowSteps = [
  {
    stage: "01",
    title: "Upload your evidence",
    detail: "Spreadsheets, notes, PDFs, and a template if you have one.",
  },
  {
    stage: "02",
    title: "Basquio builds the deck",
    detail: "Analysis, charts, narrative, and formatting. One loop.",
  },
  {
    stage: "03",
    title: "Review and send",
    detail: "Edit the PPTX, share the PDF. Same story, both formats.",
  },
] as const;

const pricingSnapshot = [
  {
    name: "Free",
    price: "$0",
    unit: "40 free credits",
    copy: "Enough for ~3 Deck runs. No credit card. See if it fits.",
    highlight: false,
  },
  {
    name: "Starter",
    price: "$29",
    unit: "/mo",
    copy: "30 credits/month. No branding. Custom template slot.",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$79",
    unit: "/mo",
    copy: "100 credits/month. Priority queue. 5 template slots.",
    highlight: true,
  },
  {
    name: "Team",
    price: "$149",
    unit: "/mo + seats",
    copy: "Shared workspace. 200 credit pool. 10 template slots.",
    highlight: false,
  },
] as const;

export default function HomePage() {
  return (
    <div className="landing-shell landing-shell-editorial">
      <PublicSiteNav />

      <section className="hero-stage marketing-hero marketing-hero-editorial">
        <div className="hero-main">
          <div className="stack">
            <p className="section-label light">Beautiful Intelligence.</p>
            <h1>Two weeks of analysis. Delivered in hours.</h1>
            <p className="hero-subtitle">Upload your data. Get back a finished deck.</p>
          </div>

          <div className="row">
            <Link className="button" href="/jobs/new">
              Try it with your data
            </Link>
            <Link className="button secondary inverted" href="/how-it-works">
              See how it works
            </Link>
          </div>
        </div>

        <div className="hero-artifact-column">
          <div className="hero-artifact-frame">
            <Image
              src="/showcase/slide-showcase-executive.svg"
              alt="Basquio executive overview slide showing KPI cards, segment performance, and a key finding"
              width={960}
              height={540}
              priority
            />
          </div>
        </div>
      </section>

      <section className="social-proof-bar">
        <p>Built by category analysts and brand managers who lived the reporting cycle.</p>
      </section>

      <section className="problem-section">
        <div className="stack">
          <p className="section-label">The bottleneck</p>
          <h2>You already have the data. The deck is what takes two weeks.</h2>
        </div>

        <div className="problem-grid">
          {problemCards.map((card) => (
            <article key={card.title} className="problem-card">
              <h3>{card.title}</h3>
              <p>{card.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="transformation-section dark-panel" id="output">
        <div className="stack">
          <p className="section-label light">The output</p>
          <h2>Upload once. Present tomorrow.</h2>
          <p className="muted">
            A finished analysis deck with real charts, a narrative report, and an editable PPTX. Ready to review, not rebuild.
          </p>
        </div>

        <SlideShowcase />
      </section>

      <section className="how-it-works-section" id="pipeline">
        <div className="stack">
          <p className="section-label">How it works</p>
          <h2>Three steps. One reporting cycle.</h2>
        </div>

        <div className="steps-row">
          {workflowSteps.map((step) => (
            <article key={step.stage} className="step-card">
              <span className="step-number">{step.stage}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="pricing-snapshot-section" id="pricing">
        <div className="pricing-snapshot-head">
          <div className="stack">
            <p className="section-label">Pricing</p>
            <h2>Start free. Pick the model that fits your team.</h2>
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
        <p className="pricing-snapshot-note">
          * Credits and report type are calculated from scope, slide count, and workflow complexity.
        </p>
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
