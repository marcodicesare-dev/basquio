import type { Metadata } from "next";

import { aboutPrinciples, aboutStory } from "@/app/site-content";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "About | Basquio",
  description:
    "Learn why Basquio was built, what problem it is solving, and who is building it.",
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
              <h1>{aboutStory.title}</h1>
              {aboutStory.paragraphs.map((paragraph) => (
                <p key={paragraph} className="page-copy">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>

          <aside className="page-hero-aside stack">
            <p className="artifact-kind">Built by</p>
            <h2>Marco Di Cesare</h2>
            <p className="muted">Founder, Basquio at Loamly</p>
            <p className="muted">
              Contact:{" "}
              <a href="mailto:marco.dicesare@loamly.ai">
                marco.dicesare@loamly.ai
              </a>
            </p>
          </aside>
        </div>
      </section>

      <section className="cards">
        {aboutPrinciples.map((principle) => (
          <article key={principle.title} className="panel stack">
            <h2>{principle.title}</h2>
            <p className="muted">{principle.copy}</p>
          </article>
        ))}
      </section>

      <section className="panel stack">
        <p className="section-label">What we believe</p>
        <h2>Good teams should spend their time on judgment, not rebuilding decks by hand.</h2>
        <p className="muted">
          Basquio exists to shorten the gap between evidence and a deck people can use. The product is still young, but
          the direction is clear: analysis-first reporting that respects both the numbers and the brand.
        </p>
      </section>

      <PublicSiteFooterCta
        eyebrow="See where it fits"
        title="Find the reporting workflow that looks most like your team."
        copy="If you want to know whether Basquio fits your world, the persona pages show the kinds of teams we are building for."
        secondaryLabel="Who it’s for"
        secondaryHref="/for"
      />
      <PublicSiteFooter />
    </div>
  );
}
