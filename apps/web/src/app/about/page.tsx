import type { Metadata } from "next";

import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "About Basquio — Built by Analysts and Brand Managers Who Lived the Problem",
  description:
    "Basquio was built by market research analysts and brand managers who spent years building category review decks manually. Now the workflow is automated.",
  alternates: { canonical: "https://basquio.com/about" },
};

export default function AboutPage() {
  return (
    <div className="page-shell public-page">
      <PublicSiteNav />

      <section className="page-hero">
        <div className="stack">
          <p className="section-label">About</p>
          <h1>Built by the people who used to make these decks by hand.</h1>
          <p className="page-copy">
            Market research analysts, CPG brand managers, and one engineer.
            We know what a good category review looks like because we&apos;ve presented hundreds of them.
          </p>
        </div>
      </section>

      <section className="panel dark-panel">
        <div className="stack">
          <p className="section-label light">Why this team</p>
          <h2>We&apos;ve been on both sides of the table.</h2>
          <p className="muted">
            The analysts who built the decks. The brand teams who received them. The engineer who automates
            the bridge between data and story.
          </p>
        </div>
      </section>

      <PublicSiteFooterCta
        eyebrow="See where it fits"
        title="Find the workflow that matches your team."
        secondaryLabel="Who it's for"
        secondaryHref="/for"
      />
      <PublicSiteFooter />
    </div>
  );
}
