import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";
import { ScrollWorkflowShowcase } from "@/components/scroll-workflow-showcase";
import { SlideShowcase } from "@/components/slide-showcase";

export const metadata: Metadata = {
  title: "Basquio - Turn Data into Finished Analysis Decks",
  description:
    "Upload CSV, Excel, or spreadsheet data and get back a finished analysis deck with real charts, a narrative report, and editable PPTX output. The only AI tool that analyzes data AND builds the presentation.",
  alternates: { canonical: "https://basquio.com" },
  openGraph: {
    title: "Basquio - Turn Data into Finished Analysis Decks",
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

const pricingSnapshot = [
  {
    name: "Free",
    price: "$0",
    unit: "30 free credits",
    copy: "Enough for ~2 Deck runs. No credit card. See if it fits.",
    highlight: false,
  },
  {
    name: "Starter",
    price: "$19",
    unit: "/mo",
    copy: "30 credits/month. No branding. 2 template slots.",
    highlight: true,
  },
  {
    name: "Pro",
    price: "$149",
    unit: "/mo",
    copy: "200 credits/month. Priority queue. 5 template slots.",
    highlight: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "",
    copy: "Shared workspace, custom billing, custom template setup.",
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
            <Link className="button secondary inverted" href="#workflow">
              See how it works
            </Link>
          </div>
        </div>

        <div className="hero-product-showcase">
          <div className="showcase-layer showcase-layer-slide">
            <div className="showcase-window-chrome" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <Image
              src="/showcase/slide-showcase-executive.svg"
              alt="Basquio executive overview slide showing KPI cards, segment performance, and a key finding"
              width={960}
              height={540}
              priority
            />
          </div>

          <div className="showcase-layer showcase-layer-chart">
            <div className="showcase-card-heading">
              <span className="showcase-card-label">Share view</span>
              <strong>Category mix</strong>
            </div>
            <div className="showcase-mini-chart" aria-hidden="true">
              <span style={{ height: "68%" }} />
              <span style={{ height: "82%" }} />
              <span className="accent" style={{ height: "100%" }} />
              <span style={{ height: "58%" }} />
              <span style={{ height: "44%" }} />
            </div>
            <p>Branded share is compressing while private label accelerates.</p>
          </div>

          <div className="showcase-layer showcase-layer-report">
            <div className="showcase-card-heading">
              <span className="showcase-card-label">Narrative</span>
              <strong>Key finding</strong>
            </div>
            <p>
              Enterprise carries most value, but private label momentum is shifting the category story in
              mid-market accounts.
            </p>
            <div className="showcase-report-lines" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
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
            A finished analysis deck with real charts, a narrative report, and an editable PowerPoint. Ready to review, not rebuild.
          </p>
        </div>

        <SlideShowcase />
      </section>

      <section className="output-examples-section">
        <div className="stack">
          <p className="section-label">Real output</p>
          <h2>See it before you try it.</h2>
          <p className="muted">
            These decks were generated by Basquio from uploaded spreadsheets. Not mockups. Download the PPTX and open it yourself.
          </p>
        </div>

        <div className="output-examples-grid">
          <Link href="/library" className="output-example-card">
            <Image
              src="/library/analysis/analysis.006.png"
              alt="Healthcare AI Platform — stacked bar chart slide"
              width={960}
              height={540}
            />
            <div className="output-example-meta">
              <span className="library-tier-badge">Deck &middot; 15 slides</span>
              <p>Healthcare AI Platform — Performance & Growth</p>
            </div>
          </Link>

          <Link href="/library" className="output-example-card">
            <Image
              src="/library/exec-summary/exec-summary.002.png"
              alt="Payment Infrastructure — KPI cards slide"
              width={960}
              height={540}
            />
            <div className="output-example-meta">
              <span className="library-tier-badge">Memo &middot; 4 slides</span>
              <p>Payment Infrastructure — Executive Summary</p>
            </div>
          </Link>

          <Link href="/library" className="output-example-card">
            <Image
              src="/library/deep-analysis/deep-analysis.003.png"
              alt="E-Commerce Marketplace — category mix stacked bars"
              width={960}
              height={540}
            />
            <div className="output-example-meta">
              <span className="library-tier-badge">Deep-Dive &middot; 10 slides</span>
              <p>E-Commerce Marketplace — Deep Dive</p>
            </div>
          </Link>
        </div>

        <Link className="button secondary" href="/library">
          See all output examples →
        </Link>
      </section>

      <ScrollWorkflowShowcase />

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

      <section className="powerpoint-tax-hook">
        <p className="section-label">The PowerPoint Tax</p>
        <h2>You lose about 14 weeks to slides every year.</h2>
        <p className="muted">The average analyst spends 580 hours a year on manual deck production. Calculate your number.</p>
        <Link className="button secondary" href="/powerpoint-tax">
          Calculate your PowerPoint Tax →
        </Link>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Upload your data. Get a finished deck in 15 minutes."
        copy="Start with a real draft, not a blank slide."
        primaryLabel="Try it with your data"
        primaryHref="/jobs/new"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
