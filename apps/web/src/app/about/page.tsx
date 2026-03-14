import type { Metadata } from "next";

import { aboutPrinciples } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "About | Basquio",
  description:
    "Basquio is an intelligence-first reporting system built for evidence packages, explicit report briefs, and brand-aware executive deliverables.",
};

export default function AboutPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label">About</p>
              <h1>Beautiful Intelligence for evidence-backed reporting.</h1>
              <p className="page-copy">
                Basquio is built for teams that already know the work is not just making slides. The hard part is
                understanding the evidence, ranking what matters, and shaping a narrative people can sign off on.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Product promise</p>
            <p>Evidence package in</p>
            <p>Report brief in</p>
            <p>Brand or template in</p>
            <p>PPTX and PDF out</p>
          </aside>
        </div>
      </section>

      <section className="cards">
        {aboutPrinciples.map((principle) => (
          <article key={principle.title} className="panel stack">
            <p className="section-label">{principle.title}</p>
            <h2>{principle.title}</h2>
            <p className="muted">{principle.copy}</p>
          </article>
        ))}
      </section>

      <section className="technical-panel stack-xl">
        <div className="stack">
          <p className="section-label light">Positioning</p>
          <h2>Data in. Executive deck out.</h2>
          <p className="muted">
            Basquio is not a generic deck generator. It is an intelligence system for structured evidence packages, explicit
            report briefs, and brand-aware deliverables.
          </p>
        </div>
      </section>

      <PublicSiteFooterCta />
    </div>
  );
}
