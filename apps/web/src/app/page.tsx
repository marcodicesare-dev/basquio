import type { Metadata } from "next";
import Link from "next/link";

import { MarketingWorkspaceVisual } from "@/components/marketing-workspace-visual";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio - The Research Workspace That Remembers",
  description:
    "Basquio keeps briefs, data, notes, templates, and past work together, then turns analyst direction into decks, reports, Excel files, charts, and review material.",
  alternates: { canonical: "https://basquio.com" },
};

const paths = [
  {
    title: "One output",
    copy: "Estimate the credit cost, buy the pack, and run the deck, report, or Excel file.",
    href: "/pay-as-you-go",
    cta: "Start pay as you go",
  },
  {
    title: "Workspace Pro",
    copy: "A private workspace for recurring clients, templates, notes, and past work.",
    href: "/workspace-pro",
    cta: "See Workspace Pro",
  },
  {
    title: "Team Workspace",
    copy: "Shared memory for brands, categories, stakeholders, templates, and reviews.",
    href: "/team-workspace",
    cta: "Plan team pilot",
  },
] as const;

const proofRows = [
  ["Material", "Brief, data, notes, old deck, template"],
  ["Workspace", "Project context, stakeholder preferences, rules, prior reviews"],
  ["Output", "Deck, report, Excel workbook, charts, review trail"],
] as const;

export default function HomePage() {
  return (
    <div className="landing-shell landing-shell-studio">
      <PublicSiteNav />

      <section className="mstudio-hero">
        <div className="mstudio-hero-copy">
          <p className="section-label light">For market research teams</p>
          <h1>Stop rebuilding context.</h1>
          <p>
            Basquio keeps the brief, data, notes, template, and past work together. When the direction is
            clear, it drafts the deck, report, Excel file, charts, and review material.
          </p>
          <div className="mstudio-hero-actions">
            <Link className="button" href="/jobs/new">
              Start one output
            </Link>
            <Link className="button secondary inverted" href="/workspace-product">
              See the workspace
            </Link>
            <Link className="mstudio-text-link" href="/security">
              Security and data handling
            </Link>
          </div>
        </div>
        <MarketingWorkspaceVisual />
      </section>

      <section className="mstudio-proof-strip" aria-label="Basquio workflow">
        {proofRows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="mstudio-router">
        <div className="mstudio-section-head">
          <p className="section-label">Choose the path</p>
          <h2>What are you trying to do?</h2>
        </div>
        <div className="mstudio-path-grid">
          {paths.map((path) => (
            <Link key={path.title} href={path.href} className="mstudio-path-card">
              <span>{path.title}</span>
              <p>{path.copy}</p>
              <strong>{path.cta}</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="mstudio-split">
        <div>
          <p className="section-label">Why Workspace matters</p>
          <h2>The output is the proof. The workspace is the product.</h2>
        </div>
        <div className="mstudio-copy-stack">
          <p>
            One-off output is useful when the job is clear. Recurring research work needs more: the same
            brand rules, the same category logic, the same stakeholder preferences, and the last review.
          </p>
          <p>
            Basquio keeps that working context in one place so the next deck, report, or workbook starts
            closer to the finish line.
          </p>
        </div>
      </section>

      <section className="mstudio-system">
        <div className="mstudio-system-node">Brief</div>
        <div className="mstudio-system-node">Sources</div>
        <div className="mstudio-system-node active">Workspace memory</div>
        <div className="mstudio-system-node">Analyst direction</div>
        <div className="mstudio-system-node output">Finished files</div>
      </section>

      <PublicSiteFooterCta
        eyebrow="Ready to start"
        title="Start with one output. Keep the context when the work repeats."
        copy="Bring the material behind the work. Basquio turns it into files your team can review."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
