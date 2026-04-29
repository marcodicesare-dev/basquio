import type { Metadata } from "next";
import Link from "next/link";

import { MarketingHeroJ } from "@/components/marketing-hero-j";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio · Decks, reports, and Excel files from research material",
  description:
    "Basquio turns briefs, data, notes, templates, and past work into decks, reports, and Excel files. Pay as you go for one output, or use a workspace for recurring research work.",
  alternates: { canonical: "https://basquio.com" },
  openGraph: {
    title: "Basquio · Decks, reports, and Excel files from research material",
    description:
      "Basquio turns briefs, data, notes, templates, and past work into decks, reports, and Excel files. Pay as you go for one output, or use a workspace for recurring research work.",
  },
};

const buyerPaths = [
  {
    eyebrow: "Pay as you go",
    title: "I have one deck, report, or Excel due.",
    body: "Upload the brief and files, see the estimated cost, buy credits, and run the output.",
    ctaLabel: "Estimate one output",
    ctaHref: "/jobs/new",
  },
  {
    eyebrow: "Workspace Pro",
    title: "I work across recurring clients and projects.",
    body: "Keep clients, brands, templates, notes, and past work in one private workspace. Best for solo consultants and independent professionals.",
    ctaLabel: "See Workspace Pro",
    ctaHref: "#workspace",
  },
  {
    eyebrow: "Team Workspace",
    title: "My team prepares research outputs every month.",
    body: "Shared memory for brands, categories, stakeholders, templates, and previous reviews. Built for recurring research work.",
    ctaLabel: "Talk about a team pilot",
    ctaHref: "/about",
  },
] as const;

const memoryModules = [
  "Clients",
  "Brands",
  "Stakeholders",
  "Templates",
  "Past reviews",
  "Brand rules",
] as const;

const useCases = [
  "Category review",
  "Brand performance update",
  "Channel readout",
  "Competitive memo",
  "Leadership pack",
] as const;

const pricingLanes = [
  {
    name: "Pay as you go",
    price: "Estimated after upload",
    description: "For one deck, report, or Excel file. No subscription, no free credits.",
    ctaLabel: "Estimate one output",
    ctaHref: "/jobs/new",
    accent: false,
  },
  {
    name: "Workspace Pro",
    price: "199 / month",
    description: "Private workspace for recurring clients and projects. Card-required 7-day trial. One user.",
    ctaLabel: "Start the trial",
    ctaHref: "/pricing",
    accent: true,
  },
  {
    name: "Team Workspace",
    price: "From 500 / month",
    description: "Shared workspace, projects, onboarding, and normal team usage included.",
    ctaLabel: "Talk about a team pilot",
    ctaHref: "/about",
    accent: false,
  },
] as const;

export default function HomePage() {
  return (
    <div className="landing-shell landing-j">
      <PublicSiteNav />

      <MarketingHeroJ />

      <section className="section-j section-j-router" id="paths" aria-labelledby="router-heading">
        <header className="section-j-head">
          <p className="section-j-eyebrow">Pick the path that matches the work</p>
          <h2 id="router-heading" className="section-j-title">
            Three buyers. One product.
          </h2>
        </header>
        <ul className="path-rows" aria-label="Buyer paths">
          {buyerPaths.map((path) => (
            <li key={path.title} className="path-row">
              <p className="path-row-eyebrow">{path.eyebrow}</p>
              <h3 className="path-row-title">{path.title}</h3>
              <p className="path-row-body">{path.body}</p>
              <Link className="path-row-link" href={path.ctaHref}>
                {path.ctaLabel}
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="section-j section-j-workspace" id="workspace" aria-labelledby="workspace-heading">
        <div className="section-j-workspace-grid">
          <header className="section-j-head">
            <p className="section-j-eyebrow">The workspace</p>
            <h2 id="workspace-heading" className="section-j-title">
              The next ask should not start from zero.
            </h2>
            <p className="section-j-body">
              The analyst still decides what matters. Basquio holds the context behind recurring work
              so the next deck, report, or workbook starts closer to done. The workspace remembers the
              client, the brand, the template, the last meeting, and the last review, so the team does
              not rebuild the same context every time.
            </p>
          </header>

          <ul className="memory-grid" aria-label="What the workspace remembers">
            {memoryModules.map((label) => (
              <li key={label} className="memory-cell">
                <span className="memory-cell-tick" aria-hidden="true" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section-j section-j-output" aria-labelledby="output-heading">
        <header className="section-j-head">
          <p className="section-j-eyebrow">One run, three files</p>
          <h2 id="output-heading" className="section-j-title">
            Editable presentation, written report, and the workbook behind every number.
          </h2>
        </header>

        <ul className="output-trio" aria-label="What Basquio produces">
          <li className="output-card output-card-deck">
            <div className="output-card-frame" aria-hidden="true">
              <div className="output-card-frame-bar">
                <span />
                <span />
                <span />
              </div>
              <div className="output-card-frame-content">
                <div className="output-card-frame-headline" />
                <div className="output-card-frame-chart">
                  <span style={{ height: "52%" }} />
                  <span style={{ height: "68%" }} />
                  <span style={{ height: "44%" }} />
                  <span style={{ height: "82%" }} />
                </div>
                <div className="output-card-frame-line" />
              </div>
            </div>
            <p className="output-card-name">Deck</p>
            <p className="output-card-body">
              Editable PowerPoint with charts, storyline, and recommendations. Built to present, not to
              be rebuilt.
            </p>
          </li>

          <li className="output-card output-card-report">
            <div className="output-card-frame" aria-hidden="true">
              <div className="output-card-frame-paragraph" />
              <div className="output-card-frame-paragraph" />
              <div className="output-card-frame-paragraph short" />
              <div className="output-card-frame-paragraph" />
              <div className="output-card-frame-paragraph short" />
            </div>
            <p className="output-card-name">Report</p>
            <p className="output-card-body">
              Written explanation of what changed, why it matters, and what to do next. Section
              headings, methodology, recommendations, sources.
            </p>
          </li>

          <li className="output-card output-card-excel">
            <div className="output-card-frame" aria-hidden="true">
              <div className="output-card-frame-tabs">
                <span className="active" />
                <span />
                <span />
              </div>
              <div className="output-card-frame-grid">
                <div className="output-card-frame-row header">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="output-card-frame-row">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="output-card-frame-row">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="output-card-frame-row">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
            <p className="output-card-name">Excel</p>
            <p className="output-card-body">
              Workbook with the tables behind every chart. Freeze panes, formatted headers, native
              charts where they matter.
            </p>
          </li>
        </ul>
      </section>

      <section className="section-j section-j-vertical" aria-labelledby="vertical-heading">
        <header className="section-j-head">
          <p className="section-j-eyebrow">Built first for FMCG and CPG</p>
          <h2 id="vertical-heading" className="section-j-title">
            Built for the work that depends on category context.
          </h2>
          <p className="section-j-body">
            Category reviews, retailer readouts, brand updates, price and promo analyses, and
            stakeholder packs all carry context: the client, the brand, the template, the last review.
            Basquio is built for that kind of work first.
          </p>
        </header>

        <ul className="usecase-row" aria-label="Common use cases">
          {useCases.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </section>

      <section className="section-j section-j-pricing" id="pricing-preview" aria-labelledby="pricing-heading">
        <header className="section-j-head">
          <p className="section-j-eyebrow">Pricing</p>
          <h2 id="pricing-heading" className="section-j-title">
            Pay for one output, or keep the work in a workspace.
          </h2>
          <p className="section-j-body">
            Credits cover one-off output. Workspace subscription covers continuity. Team Workspace
            covers shared continuity. The pricing logic matches how the work actually arrives.
          </p>
        </header>

        <div className="pricing-lanes" role="list">
          {pricingLanes.map((plan) => (
            <article
              key={plan.name}
              role="listitem"
              className={
                plan.accent ? "pricing-lane pricing-lane-accent" : "pricing-lane"
              }
            >
              <p className="pricing-lane-name">{plan.name}</p>
              <p className="pricing-lane-price">{plan.price}</p>
              <p className="pricing-lane-body">{plan.description}</p>
              <Link className="pricing-lane-link" href={plan.ctaHref}>
                {plan.ctaLabel}
                <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </div>

        <p className="pricing-lanes-footnote">
          <Link href="/pricing">See full pricing details</Link>
        </p>
      </section>

      <section className="section-j section-j-strip" aria-labelledby="security-heading">
        <div className="strip-grid">
          <header className="strip-grid-head">
            <p className="section-j-eyebrow">Security</p>
            <h2 id="security-heading" className="section-j-title strip-title">
              Clear data handling before you upload.
            </h2>
          </header>
          <div className="strip-body">
            <p>
              No model training on customer data. Workspace-level tenant isolation. Encryption in
              transit and at rest. DPA available on request. SOC 2 Type 1 is planned, not claimed.
            </p>
            <Link className="strip-link" href="/trust">
              Read security details
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="section-j section-j-strip section-j-strip-team" aria-labelledby="about-heading">
        <div className="strip-grid">
          <header className="strip-grid-head">
            <p className="section-j-eyebrow">The team</p>
            <h2 id="about-heading" className="section-j-title strip-title">
              Built by people who know this work.
            </h2>
          </header>
          <div className="strip-body">
            <p>
              Basquio comes from engineering, brand, category, and market research work. The product
              is built around the recurring deliverables teams already prepare by hand.
            </p>
            <Link className="strip-link" href="/about">
              Meet the team
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Start with one output. Or set up the workspace."
        copy="Upload the brief and files for one job. If the work comes back next month, keep the context in a workspace."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="See the workspace"
        secondaryHref="#workspace"
      />
      <PublicSiteFooter />
    </div>
  );
}
