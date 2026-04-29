import type { Metadata } from "next";
import Link from "next/link";

import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Pay as you go",
  description: "Run one Basquio output by estimating credits after the brief and source material are known.",
};

const steps = ["Add brief and material", "Review credit estimate", "Buy the credit pack", "Run the files"] as const;

export default function PayAsYouGoPage() {
  return (
    <div className="page-shell public-page mstudio-page">
      <PublicSiteNav />
      <section className="mstudio-page-hero">
        <p className="section-label">Pay as you go</p>
        <h1>One clear request. One estimated output.</h1>
        <p>
          Use pay as you go when you need a deck, report, or Excel workbook without opening a recurring
          workspace.
        </p>
        <Link className="button" href="/jobs/new">Start one output</Link>
      </section>
      <section className="mstudio-system">
        {steps.map((step, index) => (
          <div key={step} className={index === 3 ? "mstudio-system-node output" : "mstudio-system-node"}>
            {step}
          </div>
        ))}
      </section>
      <PublicSiteFooterCta
        eyebrow="Start simple"
        title="Bring the material. See the cost before the run."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="See pricing"
        secondaryHref="/pricing"
      />
      <PublicSiteFooter />
    </div>
  );
}
