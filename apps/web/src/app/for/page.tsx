import type { Metadata } from "next";
import Link from "next/link";

import { personas } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Who It's For | Basquio",
  description:
    "See how Basquio fits brand managers, consultants, strategy teams, and agencies building recurring analytical deliverables.",
};

export default function ForPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="page-header-grid">
          <div className="stack-xl">
            <div className="stack">
              <p className="section-label">Who it&apos;s for</p>
              <h1>Pick the reporting motion that matches your team.</h1>
              <p className="page-copy">
                Each workflow starts with structured evidence and ends with an executive-ready deck. The difference is what
                kind of pressure the team is under when the story has to land.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Best fit</p>
            <p>Recurring analytical reporting</p>
            <p>Stakeholder review cycles</p>
            <p>Brand-sensitive deliverables</p>
            <p>Paired PPTX and PDF outputs</p>
          </aside>
        </div>
      </section>

      <section className="persona-grid">
        {personas.map((persona) => (
          <Link key={persona.slug} className="panel persona-detail-card" href={`/for/${persona.slug}`}>
            <p className="artifact-kind">{persona.title}</p>
            <h2>{persona.summary}</h2>
            <p className="muted">{persona.challenge}</p>
          </Link>
        ))}
      </section>

      <PublicSiteFooterCta />
    </div>
  );
}
