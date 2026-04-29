import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { BuyingInterface } from "@/components/marketing-pricing-j";
import { MarketingHeroJ } from "@/components/marketing-hero-j";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { ScrollReveal } from "@/components/scroll-reveal";

export const metadata: Metadata = {
  title: "Basquio · From research files to finished decks, reports, and workbooks",
  description:
    "Basquio turns the brief, data, notes, old decks, and templates into the deck, report, and Excel file your stakeholder asked for. For recurring research work, the workspace remembers the client, brand, template, last meeting, and past reviews.",
  alternates: { canonical: "https://basquio.com" },
  openGraph: {
    title: "Basquio · From research files to finished decks, reports, and workbooks",
    description:
      "Basquio turns the brief, data, notes, old decks, and templates into the deck, report, and Excel file your stakeholder asked for.",
  },
};

const productArtifacts = [
  {
    name: "Deck",
    body: "Editable PowerPoint with charts, storyline, and recommendations. Built to present, not rebuilt.",
  },
  {
    name: "Report",
    body: "Written explanation of what changed, why it matters, and what to do next. Section headings, methodology, recommendations, sources.",
  },
  {
    name: "Excel",
    body: "Workbook with the tables behind every chart. Freeze panes, formatted headers, native charts where they matter.",
  },
] as const;

const workspaceMemory = [
  {
    name: "Client",
    body: "Who the work is for, the contact, and the relationship history.",
  },
  {
    name: "Brand",
    body: "Brand rules, tone, and what was approved last time.",
  },
  {
    name: "Template",
    body: "Approved layouts, brand-system constraints, source slides.",
  },
  {
    name: "Last meeting",
    body: "What was said, what was asked for, what stays open.",
  },
  {
    name: "Past reviews",
    body: "Prior decisions, corrections, and stakeholder feedback over time.",
  },
  {
    name: "Approved formats",
    body: "How the team likes recommendations framed and presented.",
  },
] as const;

export default function HomePage() {
  return (
    <div className="landing-shell landing-j">
      <PublicSiteNav />

      <MarketingHeroJ />

      <section
        className="section-j section-j-product section-j-split section-j-split-image-left"
        id="product"
        aria-labelledby="product-heading"
      >
        <ScrollReveal className="section-j-anchor" as="figure">
          <Image
            src="/marketing/hero-candidates/basquio-memory-context-07.jpg"
            alt=""
            fill
            sizes="(max-width: 960px) 100vw, 48vw"
            className="section-j-anchor-image"
          />
        </ScrollReveal>

        <ScrollReveal className="section-j-content" delay={120}>
          <header className="section-j-head">
            <p className="section-j-eyebrow">Product</p>
            <h2 id="product-heading" className="section-j-title">
              One run produces the deck, the report, and the Excel workbook.
            </h2>
            <p className="section-j-body">
              Basquio reads the brief and the material behind one piece of research work. From a
              single analytical pass it produces three artifacts grounded in the same numbers.
            </p>
          </header>

          <ul className="product-list" aria-label="What Basquio produces">
            {productArtifacts.map((artifact) => (
              <li key={artifact.name} className="product-line">
                <p className="product-line-name">{artifact.name}</p>
                <p className="product-line-body">{artifact.body}</p>
              </li>
            ))}
          </ul>
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-workspace section-j-split section-j-split-image-right"
        id="workspace"
        aria-labelledby="workspace-heading"
      >
        <ScrollReveal className="section-j-content">
          <header className="section-j-head">
            <p className="section-j-eyebrow">Workspace</p>
            <h2 id="workspace-heading" className="section-j-title">
              Workspace is where Basquio remembers the work behind your research.
            </h2>
            <p className="section-j-body">
              For one-off output, you give the brief and the files. For recurring work, the workspace
              holds the client, brand, template, last meeting, past reviews, and approved formats.
              The next ask starts closer to done.
            </p>
          </header>

          <ul className="memory-list" aria-label="What the workspace remembers">
            {workspaceMemory.map((module) => (
              <li key={module.name} className="memory-line">
                <p className="memory-line-name">{module.name}</p>
                <p className="memory-line-body">{module.body}</p>
              </li>
            ))}
          </ul>
        </ScrollReveal>

        <ScrollReveal className="section-j-anchor" as="figure" delay={120}>
          <Image
            src="/marketing/hero-candidates/basquio-memory-context-03.jpg"
            alt=""
            fill
            sizes="(max-width: 960px) 100vw, 48vw"
            className="section-j-anchor-image"
          />
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-buying section-j-stage section-j-stage-dark"
        id="pricing-preview"
        aria-labelledby="buying-heading"
      >
        <ScrollReveal className="section-j-stage-inner">
          <header className="section-j-head">
            <p className="section-j-eyebrow section-j-eyebrow-light">Pricing</p>
            <h2 id="buying-heading" className="section-j-title section-j-title-light">
              Pay for one output, or keep the work in a workspace.
            </h2>
            <p className="section-j-body section-j-body-light">
              Credits cover one-off output. Workspace subscription covers continuity. Team Workspace
              covers shared continuity. Pick what matches the work.
            </p>
          </header>

          <BuyingInterface variant="homepage" />

          <p className="buying-iface-footnote buying-iface-footnote-light">
            <Link href="/pricing">See pricing details</Link>
          </p>
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-row section-j-split section-j-split-image-left"
        aria-labelledby="about-heading"
      >
        <ScrollReveal className="section-j-anchor" as="figure">
          <Image
            src="/marketing/hero-candidates/basquio-memory-context-09.jpg"
            alt=""
            fill
            sizes="(max-width: 960px) 100vw, 42vw"
            className="section-j-anchor-image"
          />
        </ScrollReveal>

        <ScrollReveal className="section-j-content" delay={120}>
          <header className="section-j-head">
            <p className="section-j-eyebrow">About</p>
            <h2 id="about-heading" className="section-j-title">
              Built by FMCG and CPG analysts who lived this work.
            </h2>
            <p className="section-j-body">
              Basquio comes from engineering, brand, category, and market research work inside FMCG
              and CPG companies. The product is built around the recurring deliverables teams already
              prepare by hand. Category reviews, retailer readouts, brand updates, price and promo
              analyses, leadership packs.
            </p>
          </header>
          <p className="section-j-link-row">
            <Link className="section-j-link" href="/about">
              Meet the team
              <span aria-hidden="true">→</span>
            </Link>
          </p>
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-row section-j-split section-j-split-image-right"
        aria-labelledby="security-heading"
      >
        <ScrollReveal className="section-j-content">
          <header className="section-j-head">
            <p className="section-j-eyebrow">Security</p>
            <h2 id="security-heading" className="section-j-title">
              Clear data handling before you upload.
            </h2>
            <p className="section-j-body">
              No model training on customer data. Workspace-level tenant isolation. Encryption in
              transit and at rest. DPA available on request. SOC 2 Type 1 is planned, not claimed.
            </p>
          </header>
          <p className="section-j-link-row">
            <Link className="section-j-link" href="/security">
              Read security details
              <span aria-hidden="true">→</span>
            </Link>
          </p>
        </ScrollReveal>

        <ScrollReveal className="section-j-anchor" as="figure" delay={120}>
          <Image
            src="/marketing/hero-candidates/basquio-memory-context-06.jpg"
            alt=""
            fill
            sizes="(max-width: 960px) 100vw, 42vw"
            className="section-j-anchor-image"
          />
        </ScrollReveal>
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
