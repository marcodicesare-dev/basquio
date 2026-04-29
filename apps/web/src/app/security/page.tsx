import type { Metadata } from "next";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Security",
  description: "Basquio security, data handling, workspace isolation, and review controls.",
};

const controls = [
  ["No model training", "Customer files are not used to train foundation models."],
  ["Workspace isolation", "Research material, memory, and outputs stay scoped to the workspace."],
  ["Review control", "Humans keep the research direction and approve the finished files."],
  ["Data handling", "Security review comes before real proprietary files are used."],
] as const;

export default function SecurityPage() {
  return (
    <div className="page-shell public-page mstudio-page">
      <PublicSiteNav />
      <section className="mstudio-page-hero">
        <p className="section-label">Security</p>
        <h1>Use real research material only after the controls are clear.</h1>
        <p>
          Basquio is built for work that touches source files, templates, notes, and memory. Security is a
          first-screen buying question, not a footer detail.
        </p>
      </section>
      <section className="mstudio-path-grid">
        {controls.map(([title, copy]) => (
          <article key={title} className="mstudio-path-card">
            <span>{title}</span>
            <p>{copy}</p>
          </article>
        ))}
      </section>
      <PublicSiteFooterCta
        eyebrow="Security review"
        title="Need a data handling review before a pilot?"
        primaryLabel="Talk to us"
        primaryHref="/get-started"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
