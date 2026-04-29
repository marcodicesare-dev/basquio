import type { Metadata } from "next";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "About",
  description: "Basquio is built around the recurring work of market research teams.",
};

export default function AboutPage() {
  return (
    <div className="page-shell public-page mstudio-page">
      <PublicSiteNav />
      <section className="mstudio-page-hero">
        <p className="section-label">About</p>
        <h1>Basquio is built for the work behind research outputs.</h1>
        <p>
          The point is not to replace the analyst. The point is to stop making analysts rebuild the same
          context and production scaffolding before every deck, report, and workbook.
        </p>
      </section>
      <section className="mstudio-split">
        <div>
          <p className="section-label">Principle</p>
          <h2>The human keeps the thinking. Basquio removes the execution work.</h2>
        </div>
        <div className="mstudio-copy-stack">
          <p>Market research work depends on judgment, category context, and stakeholder nuance.</p>
          <p>
            Basquio keeps those inputs close to the brief and turns a clear direction into files the team
            can inspect, edit, and review.
          </p>
        </div>
      </section>
      <PublicSiteFooterCta
        eyebrow="Where to start"
        title="Choose the path that matches the work."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="See workspace"
        secondaryHref="/workspace-product"
      />
      <PublicSiteFooter />
    </div>
  );
}
