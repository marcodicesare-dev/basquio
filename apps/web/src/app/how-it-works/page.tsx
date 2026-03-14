import type { Metadata } from "next";
import Link from "next/link";

import { howItWorksStages } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "How It Works | Basquio",
  description:
    "See the Basquio pipeline from intake and package semantics through deterministic analytics, narrative planning, validation, and paired PPTX/PDF delivery.",
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
              <h1>Basquio turns evidence packages into executive deliverables.</h1>
              <p className="page-copy">
                The workflow is not one prompt that writes slides. Basquio moves through explicit analytical and narrative
                contracts before it renders a paired PPTX and PDF.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Canonical contracts</p>
            <p>DatasetProfile</p>
            <p>PackageSemantics</p>
            <p>ExecutableMetricSpec[]</p>
            <p>StorySpec</p>
            <p>SlideSpec[]</p>
          </aside>
        </div>
      </section>

      <section className="technical-panel stack-xl">
        <div className="row split">
          <div className="stack">
            <p className="section-label light">Nine stages</p>
            <h2>Each phase owns a real contract before the next phase begins.</h2>
          </div>
          <Link className="button secondary inverted" href="/compare">
            See the comparison
          </Link>
        </div>

        <div className="cards">
          {howItWorksStages.map((stage) => (
            <article key={stage.stage} className="signal-card stack">
              <p className="artifact-kind">{stage.stage}</p>
              <h3>{stage.title}</h3>
              <p>{stage.copy}</p>
              <p className="stage-contract">{stage.contract}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cards">
        <article className="panel stack">
          <p className="section-label">Validation</p>
          <h2>Render happens only after deterministic and semantic review.</h2>
          <p className="muted">
            Numeric assertions, chart bindings, evidence references, and narrative coherence are all checked before output is
            delivered.
          </p>
        </article>

        <article className="panel stack">
          <p className="section-label">Delivery</p>
          <h2>One planned story produces both deliverables.</h2>
          <p className="muted">
            PPTX and PDF are paired artifacts from the same slide plan, stored privately and delivered through signed URLs.
          </p>
        </article>
      </section>

      <PublicSiteFooterCta />
    </div>
  );
}
