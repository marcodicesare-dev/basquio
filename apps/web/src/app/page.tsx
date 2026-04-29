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

const workspaceMemory = [
  {
    name: "Client",
    body: "Who the work is for, the contact, and the relationship history.",
    illustration: "/marketing/illustrations/memory-spot-client.svg",
  },
  {
    name: "Brand",
    body: "Brand rules, tone, and what was approved last time.",
    illustration: "/marketing/illustrations/memory-spot-brand.svg",
  },
  {
    name: "Template",
    body: "Approved layouts, brand-system constraints, source slides.",
    illustration: "/marketing/illustrations/memory-spot-template.svg",
  },
  {
    name: "Last meeting",
    body: "What was said, what was asked for, what stays open.",
    illustration: "/marketing/illustrations/memory-spot-meeting.svg",
  },
  {
    name: "Past reviews",
    body: "Prior decisions, corrections, and stakeholder feedback over time.",
    illustration: "/marketing/illustrations/memory-spot-reviews.svg",
  },
  {
    name: "Approved formats",
    body: "How the team likes recommendations framed and presented.",
    illustration: "/marketing/illustrations/memory-spot-formats.svg",
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
        <ScrollReveal className="section-j-anchor section-j-anchor-illustration" as="figure">
          <Image
            src="/marketing/illustrations/product-anchor.svg"
            alt=""
            fill
            sizes="(max-width: 960px) 100vw, 48vw"
            className="section-j-anchor-image"
          />
        </ScrollReveal>

        <ScrollReveal className="section-j-content" delay={120}>
          <p className="section-j-eyebrow">Product</p>
          <h2 id="product-heading" className="section-j-title">
            One run, three finished files.
          </h2>
          <p className="section-j-body">
            Basquio reads the brief and the material. One run produces the deck, the report, and
            the Excel workbook.
          </p>
          <Link className="section-j-link" href="/jobs/new">
            See what Basquio produces
            <span aria-hidden="true">→</span>
          </Link>
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-workspace section-j-split section-j-split-image-right"
        id="workspace"
        aria-labelledby="workspace-heading"
      >
        <ScrollReveal className="section-j-content">
          <p className="section-j-eyebrow">Workspace</p>
          <h2 id="workspace-heading" className="section-j-title">
            Basquio remembers the research work.
          </h2>
          <p className="section-j-body">
            Client, brand, template, last meeting, past reviews, approved formats. The next ask
            starts closer to done.
          </p>
          <ul className="memory-list memory-list-illustrated" aria-label="What the workspace remembers">
            {workspaceMemory.map((module) => (
              <li key={module.name} className="memory-line memory-line-illustrated">
                <Image
                  src={module.illustration}
                  alt=""
                  width={96}
                  height={96}
                  className="memory-spot-illustration"
                />
                <div className="memory-line-copy">
                  <p className="memory-line-name">{module.name}</p>
                  <p className="memory-line-body">{module.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link className="section-j-link" href="/#workspace">
            See the workspace
            <span aria-hidden="true">→</span>
          </Link>
        </ScrollReveal>

        <ScrollReveal className="section-j-anchor section-j-anchor-illustration" as="figure" delay={120}>
          <Image
            src="/marketing/illustrations/workspace-anchor.svg"
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
              Credits cover one-off output. Workspace covers continuity. Pick what matches the work.
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
        <ScrollReveal className="section-j-anchor section-j-anchor-illustration" as="figure">
          <Image
            src="/marketing/illustrations/about-anchor.svg"
            alt=""
            fill
            sizes="(max-width: 960px) 100vw, 42vw"
            className="section-j-anchor-image"
          />
        </ScrollReveal>

        <ScrollReveal className="section-j-content" delay={120}>
          <p className="section-j-eyebrow">About</p>
          <h2 id="about-heading" className="section-j-title">
            Built by FMCG and CPG analysts who lived this work.
          </h2>
          <p className="section-j-body">
            Basquio comes from engineering, brand, category, and market research work inside FMCG
            and CPG companies.
          </p>
          <Link className="section-j-link" href="/about">
            Meet the team
            <span aria-hidden="true">→</span>
          </Link>
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-row section-j-split section-j-split-image-right"
        aria-labelledby="security-heading"
      >
        <ScrollReveal className="section-j-content">
          <p className="section-j-eyebrow">Security</p>
          <h2 id="security-heading" className="section-j-title">
            Clear data handling before you upload.
          </h2>
          <p className="section-j-body">
            No model training on customer data. Workspace-level tenant isolation. SOC 2 Type 1
            planned, not claimed.
          </p>
          <Link className="section-j-link" href="/security">
            Read security details
            <span aria-hidden="true">→</span>
          </Link>
        </ScrollReveal>

        <ScrollReveal className="section-j-anchor section-j-anchor-illustration" as="figure" delay={120}>
          <Image
            src="/marketing/illustrations/security-anchor.svg"
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
