import type { Metadata } from "next";

import { MarketingDetailPage } from "@/components/marketing-site";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio Workspace Pro | Memory for recurring research work",
  description:
    "Keep briefs, data, notes, templates, and past outputs in one private workspace for recurring research work.",
};

export default function WorkspaceProPage() {
  return (
    <>
      <PublicSiteNav />
      <MarketingDetailPage kind="workspace" />
      <PublicSiteFooter />
    </>
  );
}
