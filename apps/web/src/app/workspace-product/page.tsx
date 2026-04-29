import type { Metadata } from "next";
import Link from "next/link";

import { MarketingWorkspaceVisual } from "@/components/marketing-workspace-visual";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Workspace",
  description:
    "Basquio workspace keeps briefs, files, notes, templates, stakeholder preferences, and past reviews together for recurring market research work.",
};

const memory = ["Stakeholder preferences", "KPI definitions", "Template rules", "Prior reviews", "Brand notes"] as const;

export default function WorkspaceProductPage() {
  return (
    <div className="page-shell public-page mstudio-page">
      <PublicSiteNav />
      <section className="mstudio-workspace-hero">
        <div>
          <p className="section-label light">Workspace</p>
          <h1>Context stays ready.</h1>
          <p>
            Basquio gives recurring research work a home: material, rules, stakeholder preferences,
            templates, and past deliverables.
          </p>
          <Link className="button" href="/pricing">See pricing</Link>
        </div>
        <MarketingWorkspaceVisual />
      </section>
      <section className="mstudio-path-grid">
        {memory.map((item) => (
          <article key={item} className="mstudio-path-card">
            <span>{item}</span>
            <p>Saved as reusable context for the next ask.</p>
          </article>
        ))}
      </section>
      <PublicSiteFooterCta
        eyebrow="Workspace paths"
        title="Start private. Bring the team when the work repeats."
        primaryLabel="See Workspace Pro"
        primaryHref="/workspace-pro"
        secondaryLabel="Plan team pilot"
        secondaryHref="/team-workspace"
      />
      <PublicSiteFooter />
    </div>
  );
}
