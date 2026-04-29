import type { Metadata } from "next";

import { MarketingPricingPage } from "@/components/marketing-site";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio pricing | Pay as you go, Workspace Pro, Team Workspace",
  description:
    "Pay for one output or use a workspace for recurring research work. Basquio pricing includes pay as you go, Workspace Pro, and Team Workspace.",
  alternates: { canonical: "https://basquio.com/pricing" },
};

export default function PricingPage() {
  return (
    <>
      <PublicSiteNav />
      <MarketingPricingPage />
      <PublicSiteFooter />
    </>
  );
}
