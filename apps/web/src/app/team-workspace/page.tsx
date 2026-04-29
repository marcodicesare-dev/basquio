import type { Metadata } from "next";

import { MarketingDetailPage } from "@/components/marketing-site";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio Team Workspace | Shared memory for research teams",
  description:
    "Shared workspace for teams preparing recurring research outputs with briefs, data, notes, templates, prior reviews, and stakeholder context.",
};

export default function TeamWorkspacePage() {
  return (
    <>
      <PublicSiteNav />
      <MarketingDetailPage kind="team" />
      <PublicSiteFooter />
    </>
  );
}
