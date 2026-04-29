import type { Metadata } from "next";

import { CinematicPricingInterface, PricingLogicStrip } from "@/components/cinematic-pricing";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteFooterCta } from "@/components/public-site-footer-cta";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio Pricing",
  description:
    "Estimate credits for one market research output, start Workspace Pro at $199 per month, or plan a Team Workspace from $500 per month.",
  alternates: { canonical: "https://basquio.com/pricing" },
};

export default function PricingPage() {
  return (
    <div className="page-shell public-page cinematic-site">
      <PublicSiteNav />
      <CinematicPricingInterface />
      <PricingLogicStrip />
      <PublicSiteFooterCta
        eyebrow="Choose the first path"
        title="Start with one output, then keep the workspace if the work repeats."
        copy="Credits handle a single finished file package. Workspace Pro and Team Workspace keep context ready for the next request."
        primaryLabel="Start one output"
        primaryHref="/jobs/new"
        secondaryLabel="See the workspace"
        secondaryHref="/workspace-pro"
      />
      <PublicSiteFooter />
    </div>
  );
}
