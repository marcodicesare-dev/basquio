import type { Metadata } from "next";

import { MarketingDetailPage } from "@/components/marketing-site";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio pay as you go | Estimate one research output",
  description:
    "Upload your brief, data, notes, and template. Basquio estimates the credit cost before you pay for one deck, report, or Excel file.",
};

export default function PayAsYouGoPage() {
  return (
    <>
      <PublicSiteNav />
      <MarketingDetailPage kind="payg" />
      <PublicSiteFooter />
    </>
  );
}
