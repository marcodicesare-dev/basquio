import type { Metadata } from "next";
import Link from "next/link";

import { BuyingInterface } from "@/components/marketing-pricing-j";
import { MarketingHeroJ } from "@/components/marketing-hero-j";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio · From research files to finished decks, reports, and workbooks",
  description:
    "Basquio turns the brief, data, notes, old decks, and templates into the deck, report, and Excel file your stakeholder asked for. For recurring research work, the workspace remembers the client, brand, template, and past reviews.",
  alternates: { canonical: "https://basquio.com" },
  openGraph: {
    title: "Basquio · From research files to finished decks, reports, and workbooks",
    description:
      "Basquio turns the brief, data, notes, old decks, and templates into the deck, report, and Excel file your stakeholder asked for.",
  },
};

const memoryModules = [
  { name: "Clients", body: "Who the work is for, the contacts, the relationship history." },
  { name: "Brands", body: "Brand rules, tone, template, and what was approved last time." },
  { name: "Stakeholders", body: "Who reads the deck, what they care about, how they respond." },
  { name: "Templates", body: "Approved layouts, brand-system constraints, source slides." },
  { name: "Past reviews", body: "What was said in the meeting, what was corrected, why." },
  { name: "Briefs and data", body: "The original ask, the dataset, the methodology behind the numbers." },
] as const;

const useCases = [
  "Category review",
  "Brand performance update",
  "Channel readout",
  "Competitive memo",
  "Leadership pack",
] as const;

export default function HomePage() {
  return (
    <div className="landing-shell landing-j">
      <PublicSiteNav />

      <MarketingHeroJ />

      <section className="section-j section-j-workspace" id="workspace" aria-labelledby="workspace-heading">
        <header className="section-j-head">
          <p className="section-j-eyebrow">The workspace</p>
          <h2 id="workspace-heading" className="section-j-title">
            The next ask should not start from zero.
          </h2>
          <p className="section-j-body">
            The analyst still decides what matters. Basquio holds the context behind recurring work
            so the next deck, report, or workbook starts closer to done.
          </p>
        </header>

        <ul className="memory-grid-v2" aria-label="What the workspace remembers">
          {memoryModules.map((module) => (
            <li key={module.name} className="memory-card">
              <p className="memory-card-name">{module.name}</p>
              <p className="memory-card-body">{module.body}</p>
            </li>
          ))}
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
            stakeholder packs all carry context: the client, the brand, the template, the last
            review. Basquio is built for that kind of work first.
          </p>
        </header>

        <ul className="usecase-row" aria-label="Common use cases">
          {useCases.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </section>

      <section className="section-j section-j-buying" id="pricing-preview" aria-labelledby="buying-heading">
        <header className="section-j-head">
          <p className="section-j-eyebrow">Pricing</p>
          <h2 id="buying-heading" className="section-j-title">
            Pay for one output, or keep the work in a workspace.
          </h2>
          <p className="section-j-body">
            Credits cover one-off output. Workspace subscription covers continuity. Team Workspace
            covers shared continuity. Pick what matches the work.
          </p>
        </header>

        <BuyingInterface variant="homepage" />

        <p className="buying-iface-footnote">
          <Link href="/pricing">See pricing details</Link>
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
              Built by FMCG and CPG analysts who lived this work.
            </h2>
          </header>
          <div className="strip-body">
            <p>
              Basquio comes from engineering, brand, category, and market research work inside FMCG
              and CPG companies. The product is built around the recurring deliverables teams
              already prepare by hand.
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
