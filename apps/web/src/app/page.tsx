import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { MarketingIntentHero } from "@/components/marketing-intent-hero";
import { PublicSiteNav } from "@/components/public-site-nav";
import { ScrollWorkflowShowcase } from "@/components/scroll-workflow-showcase";
import { SlideShowcase } from "@/components/slide-showcase";

export const metadata: Metadata = {
  title: "Basquio - Research Material to Finished Files",
  description:
    "Basquio keeps research briefs, data, notes, templates, and past work together, then turns a clear research direction into decks, reports, Excel files, charts, and review material.",
  alternates: { canonical: "https://basquio.com" },
  openGraph: {
    title: "Basquio - Research Material to Finished Files",
    description:
      "Keep research material together and turn the next ask into a finished deck, report, and Excel file.",
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
    name: "One output",
    price: "Credits",
    unit: "estimated first",
    copy: "Bring the material, see the credit estimate, then run a finished file package.",
    highlight: false,
  },
  {
    name: "Workspace Pro",
    price: "$199",
    unit: "/month",
    copy: "One user, checkout-required 7-day trial, saved context for recurring work.",
    highlight: true,
  },
  {
    name: "Team Workspace",
    price: "From $500",
    unit: "",
    copy: "Shared projects, roles, reviews, onboarding, and a pilot for the team.",
    highlight: false,
  },
] as const;

export default function HomePage() {
  return (
    <div className="landing-shell landing-shell-editorial">
      <PublicSiteNav />

      <MarketingIntentHero />

      <section className="social-proof-bar">
        <p>Built around the market research reporting cycle: brief, material, output, review, repeat.</p>
      </section>

      <section className="problem-section">
        <div className="stack">
          <p className="section-label">The bottleneck</p>
          <h2>The research direction is clear. The finished files still take too long.</h2>
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
          <h2>From research material to finished files.</h2>
          <p className="muted">
            A deck, report, and Excel workbook shaped from the same brief, sources, and template.
          </p>
        </div>

        <SlideShowcase />
      </section>

      <section className="output-examples-section">
        <div className="stack">
          <p className="section-label">Real output</p>
          <h2>See it before you try it.</h2>
          <p className="muted">
            Open the library to inspect sample decks and understand the file quality before you run your own.
          </p>
        </div>

        <div className="output-examples-grid">
          <Link href="/library" className="output-example-card">
            <Image
              src="/library/analysis/analysis.006.png"
              alt="Healthcare AI Platform, stacked bar chart slide"
              width={960}
              height={540}
            />
            <div className="output-example-meta">
              <span className="library-tier-badge">Deck &middot; 15 slides</span>
              <p>Healthcare AI Platform, Performance & Growth</p>
            </div>
          </Link>

          <Link href="/library" className="output-example-card">
            <Image
              src="/library/exec-summary/exec-summary.002.png"
              alt="Payment Infrastructure, KPI cards slide"
              width={960}
              height={540}
            />
            <div className="output-example-meta">
              <span className="library-tier-badge">Memo &middot; 4 slides</span>
              <p>Payment Infrastructure, Executive Summary</p>
            </div>
          </Link>

          <Link href="/library" className="output-example-card">
            <Image
              src="/library/deep-analysis/deep-analysis.003.png"
              alt="E-Commerce Marketplace, category mix stacked bars"
              width={960}
              height={540}
            />
            <div className="output-example-meta">
              <span className="library-tier-badge">Deep-Dive &middot; 10 slides</span>
              <p>E-Commerce Marketplace, Deep Dive</p>
            </div>
          </Link>
        </div>

        <Link className="button secondary" href="/library">
          See all output examples
        </Link>
      </section>

      <ScrollWorkflowShowcase />

      <section className="pricing-snapshot-section" id="pricing">
        <div className="pricing-snapshot-head">
          <div className="stack">
            <p className="section-label">Pricing</p>
            <h2>One-off credits, a single-user workspace, or a team workspace.</h2>
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
          Credits fit one-off output. Subscription fits work that needs context next time.
        </p>
      </section>

      <section className="powerpoint-tax-hook">
        <p className="section-label">The PowerPoint Tax</p>
        <h2>You lose about 14 weeks to slides every year.</h2>
        <p className="muted">The average analyst spends 580 hours a year on manual deck production. Calculate your number.</p>
        <Link className="button secondary" href="/powerpoint-tax">
          Calculate your PowerPoint Tax
        </Link>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Start with the material you already have."
        copy="Bring the brief, sources, notes, and template. Leave with files your team can review."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
