import type { Metadata } from "next";

import { MarketingComparePage } from "@/components/marketing-site";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Compare Basquio | Research workspace and output engine",
  description:
    "Compare Basquio with manual workflows, generic chat, slide tools, and knowledge portals for recurring market research outputs.",
};

export default function ComparePage() {
  return (
    <>
      <PublicSiteNav />
      <MarketingComparePage />
      <PublicSiteFooter />
    </>
  );
}
