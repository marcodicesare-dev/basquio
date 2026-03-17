import type { Metadata } from "next";

import { evidencePackageInputs, howItWorksChecks, howItWorksPhases } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "How It Works | Basquio",
  description:
    "See exactly what happens to your files: four stages from upload to a review-ready PowerPoint and PDF with every claim verified.",
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
              <h1>Four stages. Under five minutes.</h1>
              <p className="page-copy">
                You upload one evidence package: the CSVs, spreadsheets, PDFs, briefs, and brand files behind a single
                reporting cycle. Basquio reads every file, computes the numbers, shapes the story, verifies the claims,
                and delivers a deck you can present.
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

      {/* Verification callout — moved to top */}
      <section className="panel dark-panel">
        <div className="stack">
          <p className="section-label light">What makes Basquio different</p>
          <h2>Every claim is verified before delivery.</h2>
          <p className="muted">
            After the narrative is built, a separate AI model checks every number, chart label, and
            written claim against the source data. Issues are flagged and corrected before you see the
            output.
          </p>
        </div>
        <ul className="clean-list">
          {howItWorksChecks.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="stack-xl">
        {howItWorksPhases.map((phase) => (
          <article key={phase.stage} className="panel stack-lg">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <span className="section-label">Stage {phase.stage}</span>
              <span className="pipeline-time">{phase.time}</span>
            </div>
            <div className="stack-xs">
              <h2>{phase.title}</h2>
              <p className="page-copy">{phase.copy}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="panel technical-panel">
        <div className="stack">
          <p className="section-label">What you receive</p>
          <h2>One story in two formats.</h2>
          <p className="muted">
            An editable PowerPoint for working sessions and a polished PDF for sharing — both built from the same
            analysis, the same narrative, and the same verified claims.
          </p>
        </div>
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
