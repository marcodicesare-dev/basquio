import type { Metadata } from "next";
import Link from "next/link";

import { personaSelectionPoints, personas } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Who It's For | Basquio",
  description:
    "See how Basquio fits brand managers, consultants, strategy teams, and agencies running recurring reporting workflows.",
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
              <h1>Find the reporting pressure that looks most like your team.</h1>
              <p className="page-copy">
                Basquio is strongest when teams are working from several inputs, answering to a real audience, and still
                need the deck to feel polished before it leaves the room.
              </p>
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Best fit if</p>
            <ul className="clean-list">
              {personaSelectionPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
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

      <PublicSiteFooterCta
        eyebrow="Not sure yet"
        title="Compare Basquio with the other tools teams usually start with."
        copy="If you are still deciding whether this is a better fit than generic AI or a slide tool, the comparison page lays it out plainly."
        secondaryLabel="Read the comparison"
        secondaryHref="/compare"
      />
      <PublicSiteFooter />
    </div>
  );
}
