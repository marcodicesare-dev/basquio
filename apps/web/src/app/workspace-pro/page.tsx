import type { Metadata } from "next";
import Link from "next/link";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Workspace Pro",
  description: "Workspace Pro is a private Basquio workspace for one recurring market research user.",
};

export default function WorkspaceProPage() {
  return (
    <div className="page-shell public-page mstudio-page">
      <PublicSiteNav />
      <section className="mstudio-page-hero">
        <p className="section-label">Workspace Pro</p>
        <h1>A private research workspace for recurring work.</h1>
        <p>
          $199 per month. One user. A 7-day trial that requires checkout. Best for consultants and solo
          operators who reuse context across clients or projects.
        </p>
        <Link className="button" href="/get-started">Start Workspace Pro</Link>
      </section>
      <section className="mstudio-plan-row">
        <article><span>Stores</span><strong>Templates, notes, reviews</strong><p>The working material stays available for the next request.</p></article>
        <article><span>Produces</span><strong>Deck, report, Excel</strong><p>Outputs come from the same context instead of a blank prompt.</p></article>
        <article><span>Protects</span><strong>Private workspace</strong><p>For one professional before team rollout.</p></article>
      </section>
      <PublicSiteFooterCta
        eyebrow="Private workspace"
        title="Use Workspace Pro when the work repeats."
        primaryLabel="Start Workspace Pro"
        primaryHref="/get-started"
        secondaryLabel="Compare plans"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
