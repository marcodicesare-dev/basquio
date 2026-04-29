import type { Metadata } from "next";

import { getActiveMarketingVariant } from "@/app/marketing-variant-config";
import { MarketingHome } from "@/components/marketing-site";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteNav } from "@/components/public-site-nav";

const variant = getActiveMarketingVariant();

export const metadata: Metadata = {
  title: variant.metadataTitle,
  description: variant.metadataDescription,
  alternates: { canonical: "https://basquio.com" },
  openGraph: {
    title: variant.metadataTitle,
    description: variant.metadataDescription,
  },
};

export default function HomePage() {
  return (
    <>
      <PublicSiteNav />
      <MarketingHome variant={variant} />
      <PublicSiteFooter />
    </>
  );
}
