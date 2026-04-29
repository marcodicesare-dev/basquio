import type { Metadata } from "next";
import Link from "next/link";

import { CinematicHero, CinematicHomePricing, CinematicProof } from "@/components/cinematic-marketing";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio - A Research Workspace For Finished Outputs",
  description:
    "Basquio keeps briefs, data, notes, templates, and past work together, then turns the next market research ask into a deck, report, Excel file, charts, and evidence trail.",
  alternates: { canonical: "https://basquio.com" },
  openGraph: {
    title: "Basquio - A Research Workspace For Finished Outputs",
    description:
      "A vertical AI workspace for market research teams that turns research material into decks, reports, Excel files, charts, and evidence trails.",
  },
};

export default function HomePage() {
  return (
    <div className="landing-shell cinematic-site">
      <PublicSiteNav />
      <CinematicHero />

      <section className="cinematic-context-band" aria-label="What Basquio keeps together">
        <span>Briefs</span>
        <span>Data</span>
        <span>Notes</span>
        <span>Old decks</span>
        <span>Templates</span>
        <span>Transcripts</span>
        <span>Brand rules</span>
        <span>Past work</span>
      </section>

      <CinematicProof />

      <section className="cinematic-editorial">
        <div>
          <p className="section-label">The work</p>
          <h2>The human keeps the thinking.</h2>
        </div>
        <p>
          Basquio removes the execution work between a clear research direction and finished files. The
          analyst still decides the argument, the audience, and the bar for review.
        </p>
      </section>

      <CinematicHomePricing />

      <section className="cinematic-final-route">
        <div>
          <p className="section-label light">Start with one request</p>
          <h2>Bring the next brief, the files behind it, and the output you need.</h2>
        </div>
        <div className="cinematic-final-actions">
          <Link className="button" href="/jobs/new">
            Start one output
          </Link>
          <Link className="button secondary inverted" href="/pricing">
            Compare paths
          </Link>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Your next research deck should not start from zero."
        copy="Bring the brief, data, notes, template, and past work. Review the finished deck, report, and Excel file."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
