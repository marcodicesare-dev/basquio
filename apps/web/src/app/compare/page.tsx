import type { Metadata } from "next";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Compare",
  description: "Compare Basquio with chat tools, slide tools, insight archives, and the manual status quo.",
};

const alternatives = [
  {
    title: "Manual workflow",
    copy: "The analyst rebuilds context from email, files, old decks, notes, and stakeholder comments.",
    gap: "High control, high drag.",
  },
  {
    title: "Horizontal chat",
    copy: "Good for drafting and questions, but the team still manages sources, memory, and final files.",
    gap: "Useful assistant, weak workspace.",
  },
  {
    title: "Slide tools",
    copy: "Helpful for layout and page generation, but not built around research context and review memory.",
    gap: "Design help, not research memory.",
  },
  {
    title: "Basquio",
    copy: "Keeps the work behind the output together, then drafts the deck, report, Excel file, and review material.",
    gap: "Workspace memory plus finished files.",
  },
] as const;

export default function ComparePage() {
  return (
    <div className="page-shell public-page mstudio-page">
      <PublicSiteNav />
      <section className="mstudio-page-hero">
        <p className="section-label">Compare</p>
        <h1>Most tools start after context is already lost.</h1>
        <p>
          Basquio is different because it treats the brief, source material, template rules, past reviews,
          and stakeholder preferences as part of the product.
        </p>
      </section>
      <section className="mstudio-compare-grid">
        {alternatives.map((item) => (
          <article key={item.title} className={item.title === "Basquio" ? "active" : ""}>
            <span>{item.title}</span>
            <p>{item.copy}</p>
            <strong>{item.gap}</strong>
          </article>
        ))}
      </section>
      <PublicSiteFooterCta
        eyebrow="Best next step"
        title="See the workspace before comparing outputs."
        primaryLabel="See workspace"
        primaryHref="/workspace-product"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
