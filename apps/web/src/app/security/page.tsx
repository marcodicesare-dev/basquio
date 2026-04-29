import type { Metadata } from "next";

import { MarketingDetailPage } from "@/components/marketing-site";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

export const metadata: Metadata = {
  title: "Basquio security | Data handling before upload",
  description:
    "Basquio states data handling, tenant isolation, encryption, DPA availability, and planned security milestones before you upload research files.",
};

export default function SecurityPage() {
  return (
    <>
      <PublicSiteNav />
      <MarketingDetailPage kind="security" />
      <PublicSiteFooter />
    </>
  );
}
