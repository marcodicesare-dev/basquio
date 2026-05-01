import type { Metadata } from "next";
import Link from "next/link";

import { BuyingInterface } from "@/components/marketing-pricing-j";
import { MarketingHeroJ } from "@/components/marketing-hero-j";
import {
  ProductSlideMockup,
  ReportExcerptMockup,
  SecurityAuditMockup,
  WorkbookMockup,
  WorkspaceHomeMockup,
} from "@/components/marketing-mockups";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";
import { MotionSectionHead } from "@/components/motion-section-head";
import { ScrollReveal } from "@/components/scroll-reveal";
import { WorkflowBigBlocks } from "@/components/workflow-big-blocks";

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

export default function HomePage() {
  return (
    <div className="landing-shell landing-j">
      <PublicSiteNav />

      <MarketingHeroJ />

      <div id="how-it-works">
        <WorkflowBigBlocks />
      </div>

      <section className="section-j section-j-stack" id="product" aria-labelledby="product-heading">
        <MotionSectionHead className="section-j-stack-head">
          <p className="section-j-eyebrow">Example output</p>
          <h2 id="product-heading" className="section-j-title">
            One run, three finished files.
          </h2>
          <p className="section-j-body">
            Basquio reads the brief and the material. One run produces the deck, the report, and
            the Excel workbook your stakeholder asked for.
          </p>
          <Link className="section-j-link" href="/jobs/new">
            See what Basquio produces
            <span aria-hidden="true">→</span>
          </Link>
        </MotionSectionHead>

        <ScrollReveal className="section-j-stack-anchor" as="figure" delay={120}>
          <ProductSlideMockup />
        </ScrollReveal>
      </section>

      <section className="section-j section-j-stack" id="workspace" aria-labelledby="workspace-heading">
        <MotionSectionHead className="section-j-stack-head">
          <p className="section-j-eyebrow">Workspace</p>
          <h2 id="workspace-heading" className="section-j-title">
            A workspace that learns the brand, the brief, and the analyst.
          </h2>
          <p className="section-j-body">
            Basquio holds the client, the template, the past reviews, and the stakeholder you
            present to. So the next deck starts with the context already in place, and you spend
            your time on analysis instead of rebuilding it from scratch.
          </p>
          <Link className="section-j-link" href="/#workspace">
            See the workspace
            <span aria-hidden="true">→</span>
          </Link>
        </MotionSectionHead>

        <ScrollReveal className="section-j-stack-anchor" as="figure" delay={120}>
          <WorkspaceHomeMockup />
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
              Pay for one output. Or keep the work in a workspace.
            </h2>
            <p className="section-j-body section-j-body-light">
              Three ways to use Basquio. Pick the one that matches your work.
            </p>
          </header>

          <BuyingInterface variant="homepage" />
        </ScrollReveal>
      </section>

      <section
        className="section-j section-j-stack"
        id="numbers-reconcile"
        aria-labelledby="reconciliation-heading"
      >
        <MotionSectionHead className="section-j-stack-head">
          <p className="section-j-eyebrow">Workbook</p>
          <h2 id="reconciliation-heading" className="section-j-title">
            Every chart has a row in the workbook. Every claim has a source.
          </h2>
          <p className="section-j-body">
            The 1.9 share points on slide 04 ties to row 4 of the workbook and section 2 of the
            report. So when your stakeholder pushes back, the answer is one click away.
          </p>
          <Link className="section-j-link" href="/jobs/new">
            See the workbook in the deliverable
            <span aria-hidden="true">→</span>
          </Link>
        </MotionSectionHead>

        <ScrollReveal className="section-j-stack-anchor" as="figure" delay={120}>
          <WorkbookMockup />
        </ScrollReveal>
      </section>

      <section className="section-j section-j-stack" aria-labelledby="about-heading">
        <MotionSectionHead className="section-j-stack-head">
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
        </MotionSectionHead>

        <ScrollReveal className="section-j-stack-anchor" as="figure" delay={120}>
          <ReportExcerptMockup />
        </ScrollReveal>
      </section>

      <section className="section-j section-j-stack" aria-labelledby="security-heading">
        <MotionSectionHead className="section-j-stack-head">
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
        </MotionSectionHead>

        <ScrollReveal className="section-j-stack-anchor" as="figure" delay={120}>
          <SecurityAuditMockup />
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
