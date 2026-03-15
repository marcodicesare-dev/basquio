import type { Metadata } from "next";
import Link from "next/link";

import { evidencePackageInputs, howItWorksChecks, howItWorksPhases } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "How It Works | Basquio",
  description:
    "See how Basquio moves from one evidence package to a review-ready PowerPoint and PDF in four clear steps.",
};

export default function HowItWorksPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label">How it works</p>
              <h1>From upload to review-ready deck in four clear steps.</h1>
              <p className="page-copy">
                An evidence package is simply the set of CSVs, spreadsheets, PDFs, briefs, and brand files behind one
                reporting cycle. Basquio reads that package, computes the numbers, shapes the story, and delivers both
                the PowerPoint and the PDF.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">What you upload</p>
            <ul className="clean-list">
              {evidencePackageInputs.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        </div>
      </section>

      <section className="cards">
        {howItWorksPhases.map((phase) => (
          <article key={phase.stage} className="panel stack">
            <p className="artifact-kind">{phase.stage}</p>
            <h2>{phase.title}</h2>
            <p className="muted">{phase.copy}</p>
          </article>
        ))}
      </section>

      <section className="cards">
        <article className="panel stack">
          <p className="section-label">Before delivery</p>
          <h2>Every output is checked before it leaves the workflow.</h2>
          <ul className="clean-list">
            {howItWorksChecks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="panel stack">
          <p className="section-label">What you receive</p>
          <h2>One story in two formats.</h2>
          <p className="muted">
            Basquio gives teams an editable PowerPoint for working sessions and a polished PDF for sharing, both built
            from the same analysis and the same narrative.
          </p>
          <div className="row">
            <Link className="button secondary" href="/compare">
              See how it compares
            </Link>
            <Link className="button secondary" href="/about">
              Read the product story
            </Link>
          </div>
        </article>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to try one package"
        title="Bring the files behind your next review."
        copy="Start with one reporting cycle and let Basquio show you what the first draft can look like."
        secondaryLabel="Compare the categories"
        secondaryHref="/compare"
      />
      <PublicSiteFooter />
    </div>
  );
}
